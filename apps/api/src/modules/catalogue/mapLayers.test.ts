import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { catalogueRepository } from './repository';

/*
 * GET /api/catalogue/:id/layers — what a GeoNode Map (kind 'map') expands into: its constituent,
 * already-catalogued layers, resolved from catalogue.map_composition (written by
 * orchestration/catalogue_sync.py's sync_maps, not exercised here — these tests write the
 * composition rows directly).
 */

const app = buildApp();
const PW = 's1-ml-pass-123';
const email = (who: string) => `s1-ml-${who}@webatlas.test`;
const OWNER = email('owner');
const OTHER = email('other');
const SUB_OWNER = `s1-ml-sub-${randomUUID()}`;
const SUB_OTHER = `s1-ml-sub-${randomUUID()}`;
const ids = new Map<string, string>();

const PK = {
  map: 900300, vectorPublic: 900301, rasterPrivateToOther: 900302, vectorMine: 900303, unresolved: 900304,
  otherMap: 900305, emptyMap: 900306,
};
const FIXTURE_PKS = Object.values(PK);
const resourceIds = new Map<number, string>();

async function insertResource(pk: number, o: {
  title: string; published: boolean; sub: string | null; kind?: string; view?: boolean; alternate?: string | null;
}) {
  const alternate = o.alternate === undefined ? `geonode:s1_ml_${pk}` : o.alternate;
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO catalogue.resources (geonode_pk, geonode_uuid, alternate, kind, title, abstract, owner_sub,
                                      managing_unit, is_published, is_approved, public_view, origin)
     VALUES ($1, $2, $3, $4, $5, '', $6, 'VN', $7, $7, $8, 'pipeline') RETURNING id`,
    [pk, randomUUID(), alternate, o.kind ?? 'vector', o.title, o.sub, o.published, o.view ?? true]
  );
  resourceIds.set(pk, rows[0].id);
}

async function composition(mapPk: number, rows: { layerPk: number | null; position: number; visible?: boolean; opacity?: number }[]) {
  for (const r of rows) {
    await getPool().query(
      `INSERT INTO catalogue.map_composition (map_resource_id, position, layer_resource_id, visible, opacity)
       VALUES ($1, $2, $3, $4, $5)`,
      [resourceIds.get(mapPk), r.position, r.layerPk === null ? null : resourceIds.get(r.layerPk),
       r.visible ?? true, r.opacity ?? 1]
    );
  }
}

const tokens = new Map<string, string>();
async function auth(who: string) {
  let token = tokens.get(who);
  if (!token) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: who, password: PW } });
    expect(res.statusCode).toBe(200);
    token = res.json().token as string;
    tokens.set(who, token);
  }
  return { authorization: `Bearer ${token}` };
}

async function cleanup() {
  await getPool().query(`DELETE FROM catalogue.resources WHERE geonode_pk = ANY($1::int[])`, [FIXTURE_PKS]);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 's1-ml-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanup();
  const repo = usersRepository(getPool());
  for (const who of [OWNER, OTHER]) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role: 'viewer' });
    ids.set(who, row.id);
  }
  await getPool().query(`UPDATE app.users SET oidc_subject = $2 WHERE id = $1`, [ids.get(OWNER), SUB_OWNER]);
  await getPool().query(`UPDATE app.users SET oidc_subject = $2 WHERE id = $1`, [ids.get(OTHER), SUB_OTHER]);

  await insertResource(PK.map, { title: 'Bản đồ GeoNode', published: true, sub: SUB_OTHER, kind: 'map', alternate: null });
  await insertResource(PK.otherMap, { title: 'Bản đồ khác', published: true, sub: SUB_OTHER, kind: 'map', alternate: null });
  await insertResource(PK.emptyMap, { title: 'Bản đồ trống', published: true, sub: SUB_OTHER, kind: 'map', alternate: null });
  await insertResource(PK.vectorPublic, { title: 'Lớp công khai', published: true, sub: SUB_OTHER, kind: 'vector' });
  await insertResource(PK.rasterPrivateToOther, { title: 'Lớp riêng', published: false, sub: SUB_OTHER, kind: 'raster' });
  await insertResource(PK.vectorMine, { title: 'Lớp của tôi', published: false, sub: SUB_OWNER, kind: 'vector' });

  // Map order: public vector (0), a private layer only its owner (OTHER) may see (1), the
  // caller's own private layer (2), a position whose dataset never resolved (3).
  await composition(PK.map, [
    { layerPk: PK.vectorPublic, position: 0, visible: true, opacity: 1 },
    { layerPk: PK.rasterPrivateToOther, position: 1, visible: false, opacity: 0.6 },
    { layerPk: PK.vectorMine, position: 2 },
    { layerPk: null, position: 3 },
  ]);
});

afterAll(async () => {
  await cleanup();
  await app.close();
});

describe('catalogueRepository.mapLayers', () => {
  it('orders the resolved, visible layers and carries GeoNode\'s visible/opacity', async () => {
    const layers = await catalogueRepository(getPool()).mapLayers(undefined, resourceIds.get(PK.map)!);
    expect(layers.map((l) => l.item.title)).toEqual(['Lớp công khai']);
    expect(layers[0]).toMatchObject({ visible: true, opacity: 1 });
  });

  it('shows a signed-in caller their own private layer too, in position order', async () => {
    const owner = { id: ids.get(OWNER)!, email: OWNER, role: 'viewer' as const, isAdmin: false, grants: [], oidcSubject: SUB_OWNER };
    const layers = await catalogueRepository(getPool()).mapLayers(owner, resourceIds.get(PK.map)!);
    expect(layers.map((l) => l.item.title)).toEqual(['Lớp công khai', 'Lớp của tôi']);
  });

  it('shows the Map\'s owner every layer they may see, including the private one', async () => {
    const other = { id: ids.get(OTHER)!, email: OTHER, role: 'viewer' as const, isAdmin: false, grants: [], oidcSubject: SUB_OTHER };
    const layers = await catalogueRepository(getPool()).mapLayers(other, resourceIds.get(PK.map)!);
    expect(layers.map((l) => l.item.title)).toEqual(['Lớp công khai', 'Lớp riêng']);
    expect(layers[1]).toMatchObject({ visible: false, opacity: 0.6 });
  });

  it('is an empty list for a Map with no composition rows', async () => {
    const layers = await catalogueRepository(getPool()).mapLayers(undefined, resourceIds.get(PK.emptyMap)!);
    expect(layers).toEqual([]);
  });

  it('404s for a non-map entry and for a missing id', async () => {
    await expect(catalogueRepository(getPool()).mapLayers(undefined, resourceIds.get(PK.vectorPublic)!))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(catalogueRepository(getPool()).mapLayers(undefined, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('GET /api/catalogue/:id/layers', () => {
  it('answers the resolved layers for an anonymous caller', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/catalogue/${resourceIds.get(PK.map)}/layers` });
    expect(res.statusCode).toBe(200);
    expect(res.json().layers.map((l: { item: { title: string } }) => l.item.title)).toEqual(['Lớp công khai']);
  });

  it('answers more for the Map owner, signed in', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/catalogue/${resourceIds.get(PK.map)}/layers`, headers: await auth(OTHER),
    });
    expect(res.json().layers.map((l: { item: { title: string } }) => l.item.title)).toEqual(['Lớp công khai', 'Lớp riêng']);
  });

  it('404s for a non-map entry', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/catalogue/${resourceIds.get(PK.vectorPublic)}/layers` });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown id and 400s for a malformed one', async () => {
    const missing = await app.inject({ method: 'GET', url: `/api/catalogue/${randomUUID()}/layers` });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({ method: 'GET', url: '/api/catalogue/not-a-uuid/layers' });
    expect(bad.statusCode).toBe(400);
  });
});
