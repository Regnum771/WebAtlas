import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

/*
 * Catalogue links in a personal map (layer kind 'catalogue'): the layer row names a
 * catalogue.resources entry and holds no data of its own. The summary carries the entry as the
 * reader sees it (null when the reader cannot see it, or the entry was deleted). The recipient's
 * view is covered in sharing.test.ts.
 */

const app = buildApp();
const PW = 's1-links-pass-123';
const email = (who: string) => `s1-links-${who}@webatlas.test`;
const OWNER = email('owner');
const OTHER = email('other');
const SUB_OWNER = `s1-links-sub-${randomUUID()}`;
const SUB_OTHER = `s1-links-sub-${randomUUID()}`;
const ids = new Map<string, string>();

const PK = { published: 900301, mine: 900302, others: 900303, doomed: 900304, series: 900305 };
const FIXTURE_PKS = Object.values(PK);
const resourceIds = new Map<number, string>();

const ITEM_NOT_FOUND = 'Không tìm thấy dữ liệu trong Danh mục.';
const WARN_LINK = 'Lớp liên kết Danh mục không được xuất.';

const tokens = new Map<string, string>();
async function call(who: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  let token = tokens.get(who);
  if (!token) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: who, password: PW } });
    expect(res.statusCode).toBe(200);
    token = res.json().token as string;
    tokens.set(who, token);
  }
  return app.inject({
    method, url: `/api/workspace${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}),
  });
}

async function insertResource(pk: number, o: { kind: string; title: string; published: boolean; sub: string | null; steps?: string[] }) {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO catalogue.resources (geonode_pk, geonode_uuid, alternate, kind, title, abstract, owner_sub, managing_unit,
                                      is_published, is_approved, public_view, bbox4326, origin, time_steps)
     VALUES ($1, $2, $3, $4, $5, '', $6, 'VN', $7, $7, true, ARRAY[102,8,110,24]::float8[], 'pipeline', $8::timestamptz[])
     RETURNING id`,
    [pk, randomUUID(), `geonode:s1_links_${pk}`, o.kind, o.title, o.sub, o.published, o.steps ?? null]
  );
  resourceIds.set(pk, rows[0].id);
}

async function createMap(who: string, title = 'Bản có liên kết') {
  const res = await call(who, 'POST', '/maps', { title });
  expect(res.statusCode).toBe(201);
  return res.json().map as { id: string; revision: number };
}
const revisionOf = async (who: string, mapId: string) => (await call(who, 'GET', `/maps/${mapId}`)).json().map.revision as number;
async function addLink(who: string, mapId: string, pk: number, extra: Record<string, unknown> = {}) {
  return call(who, 'POST', `/maps/${mapId}/layers`, {
    kind: 'catalogue', resourceId: resourceIds.get(pk), expectedRevision: await revisionOf(who, mapId), ...extra,
  });
}

async function cleanup() {
  await getPool().query(`DELETE FROM workspace.maps WHERE owner_id IN (SELECT id FROM app.users WHERE email LIKE 's1-links-%@webatlas.test')`);
  await getPool().query(`DELETE FROM catalogue.resources WHERE geonode_pk = ANY($1::int[])`, [FIXTURE_PKS]);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 's1-links-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanup();
  const repo = usersRepository(getPool());
  for (const [who, sub] of [[OWNER, SUB_OWNER], [OTHER, SUB_OTHER]] as const) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role: 'viewer' });
    ids.set(who, row.id);
    await getPool().query(`UPDATE app.users SET oidc_subject = $2 WHERE id = $1`, [row.id, sub]);
  }
  await insertResource(PK.published, { kind: 'vector', title: 'Trạm đo mưa', published: true, sub: SUB_OTHER });
  await insertResource(PK.mine, { kind: 'raster', title: 'Ảnh nháp của tôi', published: false, sub: SUB_OWNER });
  await insertResource(PK.others, { kind: 'vector', title: 'Nháp người khác', published: false, sub: SUB_OTHER });
  await insertResource(PK.doomed, { kind: 'vector', title: 'Sắp bị xoá', published: true, sub: null });
  await insertResource(PK.series, {
    kind: 'timeseries', title: 'Mưa giờ', published: true, sub: null, steps: ['2025-10-26T00:00:00Z', '2025-10-26T01:00:00Z'],
  });
});

afterAll(async () => {
  await cleanup();
  await app.close();
});

describe('catalogue links in a personal map', () => {
  it('the owner adds a link to a published entry: the layer carries the entry, titled after it', async () => {
    const map = await createMap(OWNER);
    const res = await addLink(OWNER, map.id, PK.series);
    expect(res.statusCode).toBe(201);
    const { layer, revision } = res.json();
    expect(revision).toBe(1);
    expect(layer).toMatchObject({
      kind: 'catalogue', title: 'Mưa giờ', position: 0, featureCount: null, raster: null,
      catalogue: {
        id: resourceIds.get(PK.series), kind: 'timeseries', title: 'Mưa giờ', layerName: `geonode:s1_links_${PK.series}`,
        timeSteps: ['2025-10-26T00:00:00.000Z', '2025-10-26T01:00:00.000Z'],
      },
    });
    // The resource id travels only inside the entry, never as a column of its own.
    expect(layer).not.toHaveProperty('catalogueResourceId');

    const detail = (await call(OWNER, 'GET', `/maps/${map.id}`)).json().map;
    expect(detail.layers).toHaveLength(1);
    expect(detail.layers[0]).toMatchObject({ id: layer.id, kind: 'catalogue', catalogue: { id: resourceIds.get(PK.series) } });
    // Every other kind reads catalogue: null.
    const free = await call(OWNER, 'POST', `/maps/${map.id}/layers`, {
      kind: 'free', title: 'Điểm', geometryType: 'point', fields: [], expectedRevision: 1,
    });
    expect(free.statusCode).toBe(201);
    expect(free.json().layer.catalogue).toBeNull();
  });

  it('takes a title of its own, and the owner sees their own unpublished entry', async () => {
    const map = await createMap(OWNER);
    const res = await addLink(OWNER, map.id, PK.mine, { title: 'Ảnh của tôi' });
    expect(res.statusCode).toBe(201);
    expect(res.json().layer).toMatchObject({ title: 'Ảnh của tôi', catalogue: { id: resourceIds.get(PK.mine), mine: true, isPublished: false } });
  });

  it('a link to an entry the caller cannot see, or to none, is 404 and adds nothing', async () => {
    const map = await createMap(OWNER);
    const hidden = await addLink(OWNER, map.id, PK.others);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().error).toEqual({ code: 'NOT_FOUND', message: ITEM_NOT_FOUND });
    const ghost = await call(OWNER, 'POST', `/maps/${map.id}/layers`, { kind: 'catalogue', resourceId: randomUUID(), expectedRevision: 0 });
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json().error.message).toBe(ITEM_NOT_FOUND);
    const detail = (await call(OWNER, 'GET', `/maps/${map.id}`)).json().map;
    expect(detail.layers).toEqual([]);
    expect(detail.revision).toBe(0);
  });

  it('resourceId is required; a stranger gets the map 404 and a stale revision 409', async () => {
    const map = await createMap(OWNER);
    const missing = await call(OWNER, 'POST', `/maps/${map.id}/layers`, { kind: 'catalogue', expectedRevision: 0 });
    expect(missing.statusCode).toBe(400);
    const stranger = await call(OTHER, 'POST', `/maps/${map.id}/layers`, {
      kind: 'catalogue', resourceId: resourceIds.get(PK.published), expectedRevision: 0,
    });
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json().error.message).toBe('Không tìm thấy bản đồ.');
    const stale = await call(OWNER, 'POST', `/maps/${map.id}/layers`, {
      kind: 'catalogue', resourceId: resourceIds.get(PK.published), expectedRevision: 5,
    });
    expect(stale.statusCode).toBe(409);
  });

  it('a deleted entry keeps the layer, with catalogue: null', async () => {
    const map = await createMap(OWNER);
    const res = await addLink(OWNER, map.id, PK.doomed);
    expect(res.statusCode).toBe(201);
    await getPool().query(`DELETE FROM catalogue.resources WHERE id = $1`, [resourceIds.get(PK.doomed)]);
    const detail = (await call(OWNER, 'GET', `/maps/${map.id}`)).json().map;
    expect(detail.layers).toHaveLength(1);
    expect(detail.layers[0]).toMatchObject({ id: res.json().layer.id, kind: 'catalogue', title: 'Sắp bị xoá', catalogue: null });
    const { rows } = await getPool().query(`SELECT catalogue_resource_id FROM workspace.map_layers WHERE id = $1`, [res.json().layer.id]);
    expect(rows[0].catalogue_resource_id).toBeNull();
  });

  it('a link is renamed, moved and removed like any layer; it has no features or table', async () => {
    const map = await createMap(OWNER);
    const link = (await addLink(OWNER, map.id, PK.published)).json().layer;
    const renamed = await call(OWNER, 'PATCH', `/maps/${map.id}/layers/${link.id}`, { title: 'Trạm mưa', expectedRevision: 1 });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().layer).toMatchObject({ title: 'Trạm mưa', catalogue: { id: resourceIds.get(PK.published) } });
    const fields = await call(OWNER, 'PATCH', `/maps/${map.id}/layers/${link.id}`, { fields: [], expectedRevision: 2 });
    expect(fields.statusCode).toBe(400);

    const features = await call(OWNER, 'GET', `/maps/${map.id}/layers/${link.id}/features?bbox=0,0,1,1`);
    expect(features.statusCode).toBe(400);
    const table = await call(OWNER, 'POST', `/maps/${map.id}/layers/${link.id}/query`, {});
    expect(table.statusCode).toBe(400);

    const removed = await call(OWNER, 'DELETE', `/maps/${map.id}/layers/${link.id}`, { expectedRevision: 2 });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().revision).toBe(3);
    expect((await call(OWNER, 'GET', `/maps/${map.id}`)).json().map.layers).toEqual([]);
  });

  it('an export skips a link with a warning; a map of links only has nothing to export', async () => {
    const map = await createMap(OWNER);
    const link = (await addLink(OWNER, map.id, PK.published)).json().layer;
    const preview = await call(OWNER, 'GET', `/maps/${map.id}/exports/preview?format=gpkg&crs=wgs84-dd`);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({ layers: [], warnings: [WARN_LINK] });
    const only = await call(OWNER, 'POST', `/maps/${map.id}/exports`, { format: 'gpkg', crs: 'wgs84-dd', layerIds: [link.id] });
    expect(only.statusCode).toBe(400);
    expect(only.json().error.message).toBe('Bản đồ không có lớp nào để xuất.');

    const free = await call(OWNER, 'POST', `/maps/${map.id}/layers`, {
      kind: 'free', title: 'Điểm', geometryType: 'point', fields: [], expectedRevision: 1,
    });
    const queued = await call(OWNER, 'POST', `/maps/${map.id}/exports`, { format: 'gpkg', crs: 'wgs84-dd' });
    expect(queued.statusCode).toBe(201);
    expect(queued.json().warnings).toEqual([WARN_LINK]);
    const { rows } = await getPool().query<{ params: { layers: Array<{ layerId: string }> } }>(
      `SELECT params FROM workspace.jobs WHERE id = $1`, [queued.json().job.id]
    );
    expect(rows[0].params.layers.map((l) => l.layerId)).toEqual([free.json().layer.id]);
  });

  it('copying a map keeps its links, each seen with the copier\'s own visibility', async () => {
    const map = await createMap(OWNER);
    await addLink(OWNER, map.id, PK.published);
    await addLink(OWNER, map.id, PK.mine);
    await call(OWNER, 'POST', `/maps/${map.id}/shares`, { userId: ids.get(OTHER) });
    const copied = await call(OTHER, 'POST', `/maps/${map.id}/copy`);
    expect(copied.statusCode).toBe(201);
    const layers = copied.json().map.layers;
    expect(layers.map((l: { kind: string; title: string }) => [l.kind, l.title])).toEqual([
      ['catalogue', 'Trạm đo mưa'], ['catalogue', 'Ảnh nháp của tôi'],
    ]);
    expect(layers[0].catalogue).toMatchObject({ id: resourceIds.get(PK.published), mine: true });
    expect(layers[1].catalogue).toBeNull();
  });
});
