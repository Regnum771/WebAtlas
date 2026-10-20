import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { discardDraft, versionsService } from '@webatlas/versioning';
import { pinLayer, restoreActive, runStages, unpinLayer } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const LAYER = 'dams';
const SOURCE = 'editCopies.test';
const PIN = 'editCopies.test';
const PW = 'p3a-editcopy-pass-123';
const email = (who: string) => `p3a-editcopy-${who}@webatlas.test`;
const O = email('owner');
const R = email('recipient');
const ids = new Map<string, string>();

const OWNER_ONLY = 'Chỉ người tạo bản đồ được sửa bản đồ này.';
const MAP_CHANGED = 'Bản đồ đã thay đổi ở nơi khác.';
const DRAFT_GONE = 'Bản nháp của lớp này không còn.';

// Synthetic dams for P3a, all managed by 48, one every 0.01° along a line in Đà Nẵng.
const DAMS = Array.from({ length: 10 }, (_, i) => 901001 + i);
const xOf = (ext: number) => 108 + (ext - 901000) * 0.01;
const Y = 16.05;
/** A bbox around exactly the given synthetic dams (they must be consecutive). */
const bboxAround = (first: number, last: number) => `${xOf(first) - 0.005},${Y - 0.01},${xOf(last) + 0.005},${Y + 0.01}`;
const ALL = bboxAround(DAMS[0], DAMS[9]);

/** Versions this file created itself (root, upstream), in creation order. */
const created: string[] = [];
let priorActive: string | null = null;

// One login per user for the whole file: /api/auth/login allows 10 per minute.
const tokens = new Map<string, string>();
async function tokenFor(who: string) {
  const cached = tokens.get(who);
  if (cached) return cached;
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: who, password: PW } });
  expect(res.statusCode).toBe(200);
  const token = res.json().token as string;
  tokens.set(who, token);
  return token;
}
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function call(who: string, method: Method, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method, url: `/api/workspace${url}`,
    headers: { authorization: `Bearer ${await tokenFor(who)}` },
    ...(payload ? { payload } : {}),
  });
}

async function createMap(title = 'Bản đồ sửa lớp') {
  const res = await call(O, 'POST', '/maps', { title });
  expect(res.statusCode).toBe(201);
  return res.json().map as { id: string; revision: number };
}
async function revisionOf(mapId: string): Promise<number> {
  return (await call(O, 'GET', `/maps/${mapId}`)).json().map.revision;
}
/** A map with one edit copy of dams; returns the map, the layer and its features URL. */
async function mapWithEditCopy() {
  const map = await createMap();
  const res = await call(O, 'POST', `/maps/${map.id}/layers`, { kind: 'edit_copy', layerKey: LAYER, expectedRevision: 0 });
  expect(res.statusCode).toBe(201);
  const layer = res.json().layer as { id: string; draftId: string };
  return { map, layer, base: `/maps/${map.id}/layers/${layer.id}` };
}

type Feature = { id: string; geometry: unknown; properties: Record<string, unknown> };
async function read(base: string, bbox = ALL, who = O) {
  const res = await call(who, 'GET', `${base}/features?bbox=${bbox}`);
  expect(res.statusCode).toBe(200);
  return res.json() as { type: string; features: Feature[]; truncated: boolean; changed: string[] };
}
const byExt = (fc: { features: Feature[] }, ext: number) =>
  fc.features.find((f) => f.properties.external_id === String(ext));

async function draftRowCount(draftId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM water.dams WHERE dataset_version_id = $1`, [draftId]
  );
  return rows[0].n;
}
async function versionCount(id: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM app.dataset_versions WHERE id = $1`, [id]
  );
  return rows[0].n;
}
async function activeName(ext: number): Promise<string | null> {
  const { rows } = await getPool().query<{ name: string }>(`SELECT name FROM water.dams_active WHERE external_id = $1`, [ext]);
  return rows[0]?.name ?? null;
}

/** Run fn in a committed transaction; always roll back before releasing the client. */
async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

async function insertDam(c: pg.PoolClient, versionId: string, ext: number, name: string): Promise<void> {
  await c.query(
    `INSERT INTO water.dams
       (external_id, name, geom, dataset_version_id, province_codes, ward_codes, managing_unit, deleted)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, '{}', '{}', '48', false)`,
    [ext, name, xOf(ext), Y, versionId]
  );
}

/** Publish upstream changes (dams changed or added): a new edit version on the active one, activated. */
async function upstream(dams: Array<[number, string]>): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, is_active)
       SELECT $1, 'edit', id, $2, 'editCopies-test upstream', false
         FROM app.dataset_versions WHERE layer_key = $1 AND is_active
       RETURNING id`,
      [LAYER, SOURCE]
    );
    created.push(rows[0].id);
    for (const [ext, name] of dams) await insertDam(c, rows[0].id, ext, name);
    await versionsService(getPool()).activate(c, LAYER, rows[0].id);
  });
}

async function cleanupUsers() {
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3a-editcopy-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  const pool = getPool();
  await cleanupUsers();
  const repo = usersRepository(pool);
  // Viewers with no group: no jurisdiction anywhere.
  for (const [who, name] of [[O, 'Chủ'], [R, 'Người nhận']] as const) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: name, role: 'viewer' });
    ids.set(who, row.id);
  }
  priorActive = await versionsService(pool).getActiveVersionId(LAYER);
  // This file commits activations on dams: pin every existing version so retention cannot prune
  // a real ingest while it runs.
  await pinLayer(pool, LAYER, PIN);
  // Our own synthetic root: the layer's active state for the duration of this file.
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ($1, 'ingest', $2, 'editCopies-test root', false) RETURNING id`,
      [LAYER, SOURCE]
    );
    created.push(rows[0].id);
    for (const ext of DAMS) await insertDam(c, rows[0].id, ext, `dam-${ext}`);
    await versionsService(pool).activate(c, LAYER, rows[0].id);
  });
});

afterAll(async () => {
  const pool = getPool();
  const userIds = [...ids.values()];
  // Until the prior version is active again, one of ours is the active version of dams: deleting
  // our versions then would leave the layer with none.
  let restored = priorActive === null;
  let drafts: string[] = [];
  await runStages([
    async () => {
      if (!priorActive) return;
      await restoreActive(pool, LAYER, priorActive);
      restored = true;
    },
    () => unpinLayer(pool, PIN),
    // The drafts our users opened; their maps go with the users (CASCADE), the drafts do not.
    async () => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM app.dataset_versions WHERE ingested_by = ANY($1::uuid[]) AND draft_status IS NOT NULL`,
        [userIds]
      );
      drafts = rows.map((r) => r.id);
    },
    () => pool.query(`DELETE FROM workspace.maps WHERE owner_id = ANY($1::uuid[])`, [userIds]),
    async () => {
      for (const id of drafts) await tx((c) => discardDraft(c, id));
    },
    // Rows first (no cascade from the version), then versions, children before parents.
    async () => {
      if (restored) await pool.query(`DELETE FROM water.dams WHERE dataset_version_id = ANY($1::uuid[])`, [created]);
    },
    async () => {
      if (!restored) return;
      for (const id of [...created].reverse()) await pool.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [id]);
    },
    // audit_log.user_id is ON DELETE SET NULL: delete the audit rows before their users.
    () => pool.query(`DELETE FROM app.audit_log WHERE user_id = ANY($1::uuid[])`, [userIds]),
    cleanupUsers,
    () => app.close(),
  ]);
});

describe('edit-copy layers', () => {
  it('adding an edit copy opens a personal draft owned by the map owner', async () => {
    const map = await createMap();
    const res = await call(O, 'POST', `/maps/${map.id}/layers`, { kind: 'edit_copy', layerKey: LAYER, expectedRevision: 0 });
    expect(res.statusCode).toBe(201);
    const { layer, revision } = res.json();
    expect(revision).toBe(1);
    expect(layer).toMatchObject({
      kind: 'edit_copy', layerKey: LAYER, title: 'Sửa lớp Đập & hồ chứa', position: 0, featureCount: null,
    });
    const { rows } = await getPool().query(
      `SELECT v.layer_key, v.draft_status, v.ingested_by, v.revision,
              v.parent_version_id = (SELECT id FROM app.dataset_versions WHERE layer_key = 'dams' AND is_active) AS on_active
         FROM app.dataset_versions v WHERE v.id = $1`,
      [layer.draftId]
    );
    expect(rows[0]).toEqual({ layer_key: LAYER, draft_status: 'personal', ingested_by: ids.get(O), revision: 0, on_active: true });

    // A title of the owner's choosing, and the map's layer list shows the copy.
    const named = await call(O, 'POST', `/maps/${map.id}/layers`, {
      kind: 'edit_copy', layerKey: LAYER, title: 'Đập cần rà soát', expectedRevision: 1,
    });
    expect(named.statusCode).toBe(201);
    expect(named.json().layer).toMatchObject({ title: 'Đập cần rà soát', position: 1 });
    const detail = (await call(O, 'GET', `/maps/${map.id}`)).json().map;
    expect(detail.layers.map((l: { kind: string }) => l.kind)).toEqual(['edit_copy', 'edit_copy']);

    // An unknown layer key is refused, and nothing is opened or bumped.
    const unknown = await call(O, 'POST', `/maps/${map.id}/layers`, { kind: 'edit_copy', layerKey: 'roads', expectedRevision: 2 });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe('VALIDATION_ERROR');
    expect(await revisionOf(map.id)).toBe(2);
  });

  it('edit-copy writes go to the draft and bump the map revision', async () => {
    const { map, layer, base } = await mapWithEditCopy();
    const before = await read(base);
    expect(before.changed).toEqual([]);
    expect(before.features).toHaveLength(10);
    const target = byExt(before, DAMS[2])!;
    expect(target.properties).toMatchObject({ external_id: String(DAMS[2]), managing_unit: '48', name: `dam-${DAMS[2]}` });

    const res = await call(O, 'PUT', `${base}/features/${target.id}`, { properties: { name: 'Đập đã sửa' }, expectedRevision: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ revision: 2, warnings: [] });
    expect(res.json().feature.properties).toMatchObject({ external_id: String(DAMS[2]), name: 'Đập đã sửa' });

    // The draft holds the row, the read shows it and lists it as changed; the official layer
    // is untouched.
    const { rows } = await getPool().query<{ external_id: string; name: string }>(
      `SELECT external_id::text, name FROM water.dams WHERE dataset_version_id = $1`, [layer.draftId]
    );
    expect(rows).toEqual([{ external_id: String(DAMS[2]), name: 'Đập đã sửa' }]);
    const after = await read(base);
    expect(after.changed).toEqual([String(DAMS[2])]);
    expect(after.features).toHaveLength(10);
    expect(byExt(after, DAMS[2])!.properties.name).toBe('Đập đã sửa');
    expect(await activeName(DAMS[2])).toBe(`dam-${DAMS[2]}`);
    expect(await revisionOf(map.id)).toBe(2);
    const draft = await getPool().query(`SELECT revision FROM app.dataset_versions WHERE id = $1`, [layer.draftId]);
    expect(draft.rows[0].revision).toBe(1);

    // Add a dam and delete another: both land in the draft only.
    const added = await call(O, 'POST', `${base}/features`, {
      geometry: { type: 'Point', coordinates: [xOf(DAMS[4]) + 0.002, Y] },
      properties: { name: 'Đập mới', managing_unit: '48' }, expectedRevision: 2,
    });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ revision: 3, feature: { properties: { name: 'Đập mới', managing_unit: '48' } } });
    const removed = await call(O, 'DELETE', `${base}/features/${byExt(after, DAMS[5])!.id}`, { expectedRevision: 3 });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ revision: 4 });
    const last = await read(base);
    expect(last.features).toHaveLength(10); // +1 added, -1 removed
    expect(byExt(last, DAMS[5])).toBeUndefined();
    expect(last.features.some((f) => f.properties.name === 'Đập mới')).toBe(true);
    expect(last.changed).toHaveLength(3);
    expect(await activeName(DAMS[5])).toBe(`dam-${DAMS[5]}`);

    // Title, style and position are edited like any layer's.
    const patched = await call(O, 'PATCH', base, { title: 'Đập rà soát', style: { color: '#00f' }, expectedRevision: 4 });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ revision: 5, layer: { title: 'Đập rà soát', style: { color: '#00f' }, kind: 'edit_copy' } });
  });

  it('edit-copy write with a stale map revision changes nothing', async () => {
    const { map, layer, base } = await mapWithEditCopy();
    const target = byExt(await read(base), DAMS[3])!;
    const stale = await call(O, 'PUT', `${base}/features/${target.id}`, { properties: { name: 'muộn' }, expectedRevision: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'MAP_CHANGED', message: MAP_CHANGED });
    const staleAdd = await call(O, 'POST', `${base}/features`, {
      geometry: { type: 'Point', coordinates: [xOf(DAMS[3]), Y] }, properties: { managing_unit: '48' }, expectedRevision: 0,
    });
    expect(staleAdd.json().error.code).toBe('MAP_CHANGED');
    const staleDel = await call(O, 'DELETE', `${base}/features/${target.id}`, { expectedRevision: 0 });
    expect(staleDel.json().error.code).toBe('MAP_CHANGED');
    expect(await draftRowCount(layer.draftId)).toBe(0);
    expect(await revisionOf(map.id)).toBe(1);
    const draft = await getPool().query(`SELECT revision FROM app.dataset_versions WHERE id = $1`, [layer.draftId]);
    expect(draft.rows[0].revision).toBe(0);
  });

  it('no jurisdiction check on personal edits', async () => {
    // The owner is a viewer in no group: no jurisdiction over 48 or 51.
    const { base } = await mapWithEditCopy();
    const target = byExt(await read(base), DAMS[6])!;
    const moved = await call(O, 'PUT', `${base}/features/${target.id}`, { properties: { managing_unit: '51' }, expectedRevision: 1 });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().feature.properties.managing_unit).toBe('51');
    // Now a dam managed by 51.
    const edited = await call(O, 'PUT', `${base}/features/${target.id}`, { properties: { name: 'Đập của 51' }, expectedRevision: 2 });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().feature.properties).toMatchObject({ managing_unit: '51', name: 'Đập của 51' });
  });

  it('bbox read is capped and says so', async () => {
    const { base } = await mapWithEditCopy();
    const two = bboxAround(DAMS[0], DAMS[1]);
    const capped = await call(O, 'GET', `${base}/features?bbox=${two}&limit=1`);
    expect(capped.statusCode).toBe(200);
    expect(capped.json().features).toHaveLength(1);
    expect(capped.json().truncated).toBe(true);
    const full = await read(base, two);
    expect(full.features).toHaveLength(2);
    expect(full.truncated).toBe(false);
    const noBbox = await call(O, 'GET', `${base}/features`);
    expect(noBbox.statusCode).toBe(400);
    expect(noBbox.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('a share recipient reads an edit copy but cannot write it', async () => {
    const { map, base } = await mapWithEditCopy();
    await getPool().query(
      `INSERT INTO workspace.map_shares (map_id, user_id, created_by) VALUES ($1, $2, $3)`,
      [map.id, ids.get(R), ids.get(O)]
    );
    const fc = await read(base, ALL, R);
    expect(fc.features).toHaveLength(10);
    const put = await call(R, 'PUT', `${base}/features/${fc.features[0].id}`, { properties: { name: 'x' }, expectedRevision: 1 });
    expect(put.statusCode).toBe(403);
    expect(put.json().error.message).toBe(OWNER_ONLY);
    expect((await call(R, 'DELETE', base, { expectedRevision: 1 })).statusCode).toBe(403);
  });

  it("after the layer moved on, untouched features show the current official state and the draft's edits stay", async () => {
    const { layer, base } = await mapWithEditCopy();
    const target = byExt(await read(base), DAMS[7])!;
    const res = await call(O, 'PUT', `${base}/features/${target.id}`, { properties: { name: 'sửa trong nháp' }, expectedRevision: 1 });
    expect(res.statusCode).toBe(200);

    // Someone publishes a change to another dam and adds a new one: the draft's parent is no
    // longer active, and the new dam is not in the draft's chain at all.
    const ADDED = 901011;
    await upstream([[DAMS[8], 'đổi ở lớp chính thức'], [ADDED, 'thêm ở lớp chính thức']]);
    const parent = await getPool().query(
      `SELECT parent_version_id <> (SELECT id FROM app.dataset_versions WHERE layer_key = 'dams' AND is_active) AS moved
         FROM app.dataset_versions WHERE id = $1`,
      [layer.draftId]
    );
    expect(parent.rows[0].moved).toBe(true);

    // The draft's edit and the upstream change both appear.
    const fc = await read(base);
    expect(fc.features).toHaveLength(10);
    expect(fc.changed).toEqual([String(DAMS[7])]);
    expect(byExt(fc, DAMS[7])!.properties.name).toBe('sửa trong nháp');
    expect(byExt(fc, DAMS[8])!.properties.name).toBe('đổi ở lớp chính thức');

    // A geometry-only edit of the upstream-changed dam starts from what the read showed: the
    // draft stores the upstream name, not the one it branched from.
    const moved = { type: 'Point', coordinates: [108.09, 16.051] }; // dam 901009, moved north
    const geo = await call(O, 'PUT', `${base}/features/${byExt(fc, DAMS[8])!.id}`, { geometry: moved, expectedRevision: 2 });
    expect(geo.statusCode).toBe(200);
    expect(geo.json().feature).toMatchObject({ geometry: moved, properties: { name: 'đổi ở lớp chính thức' } });
    const stored = await getPool().query(
      `SELECT name FROM water.dams WHERE dataset_version_id = $1 AND external_id = $2`, [layer.draftId, DAMS[8]]
    );
    expect(stored.rows).toEqual([{ name: 'đổi ở lớp chính thức' }]);

    // The dam added upstream can be updated, then deleted, through the edit copy.
    const wide = bboxAround(DAMS[0], ADDED);
    const added = byExt(await read(base, wide), ADDED)!;
    expect(added.properties.name).toBe('thêm ở lớp chính thức');
    const renamed = await call(O, 'PUT', `${base}/features/${added.id}`, { properties: { name: 'thêm rồi sửa' }, expectedRevision: 3 });
    expect(renamed.statusCode).toBe(200);
    expect(byExt(await read(base, wide), ADDED)!.properties.name).toBe('thêm rồi sửa');
    const renamedId = renamed.json().feature.id as string;
    const removed = await call(O, 'DELETE', `${base}/features/${renamedId}`, { expectedRevision: 4 });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ revision: 5 });

    // The next read shows both results; the official layer is untouched.
    const after = await read(base, wide);
    expect(after.features).toHaveLength(10); // 10 root dams + 1 added upstream - 1 deleted here
    expect(byExt(after, DAMS[8])).toMatchObject({ geometry: moved, properties: { name: 'đổi ở lớp chính thức' } });
    expect(byExt(after, ADDED)).toBeUndefined();
    expect(after.changed).toEqual([String(DAMS[7]), String(DAMS[8]), String(ADDED)]);
    expect(await activeName(ADDED)).toBe('thêm ở lớp chính thức');
  });

  it('deleting the layer or the map discards the draft', async () => {
    const one = await mapWithEditCopy();
    const t1 = byExt(await read(one.base), DAMS[0])!;
    await call(O, 'PUT', `${one.base}/features/${t1.id}`, { properties: { name: 'sẽ xoá' }, expectedRevision: 1 });
    expect(await draftRowCount(one.layer.draftId)).toBe(1);
    const del = await call(O, 'DELETE', one.base, { expectedRevision: 2 });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ revision: 3 });
    expect(await versionCount(one.layer.draftId)).toBe(0);
    expect(await draftRowCount(one.layer.draftId)).toBe(0);
    expect((await call(O, 'GET', `/maps/${one.map.id}`)).json().map.layers).toEqual([]);

    const two = await mapWithEditCopy();
    const t2 = byExt(await read(two.base), DAMS[1])!;
    await call(O, 'PUT', `${two.base}/features/${t2.id}`, { properties: { name: 'sẽ xoá' }, expectedRevision: 1 });
    const delMap = await call(O, 'DELETE', `/maps/${two.map.id}`, { expectedRevision: 2 });
    expect(delMap.statusCode).toBe(204);
    expect(await versionCount(two.layer.draftId)).toBe(0);
    expect(await draftRowCount(two.layer.draftId)).toBe(0);
  });

  it('a layer whose draft is gone answers 410', async () => {
    const { map, layer, base } = await mapWithEditCopy();
    // The draft is discarded elsewhere (P2's own discard); the layer row outlives it.
    await tx((c) => discardDraft(c, layer.draftId));
    const gone = await call(O, 'GET', `${base}/features?bbox=${ALL}`);
    expect(gone.statusCode).toBe(410);
    expect(gone.json().error).toEqual({ code: 'DRAFT_GONE', message: DRAFT_GONE });
    const write = await call(O, 'POST', `${base}/features`, {
      geometry: { type: 'Point', coordinates: [xOf(DAMS[0]), Y] }, properties: { managing_unit: '48' }, expectedRevision: 1,
    });
    expect(write.statusCode).toBe(410);
    expect(await revisionOf(map.id)).toBe(1);
    // The layer itself can still be removed.
    const del = await call(O, 'DELETE', base, { expectedRevision: 1 });
    expect(del.statusCode).toBe(200);
  });
});
