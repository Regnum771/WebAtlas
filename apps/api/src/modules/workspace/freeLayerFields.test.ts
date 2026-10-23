import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runStages } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

// Editing a free layer's fields (PATCH .../layers/:layerId with `fields`). A file of its own:
// freeLayers.test.ts is close to the per-address rate limit.

const app = buildApp();
const PW = 'p3c-fields-pass-123';
const email = (who: string) => `p3c-fields-${who}@webatlas.test`;
const O = email('owner');
const R = email('recipient');
const ids = new Map<string, string>();

const UNSUPPORTED = { error: { code: 'VALIDATION_ERROR', message: 'Loại lớp này chưa hỗ trợ thao tác này.' } };
const OWNER_ONLY = 'Chỉ người tạo bản đồ được sửa bản đồ này.';

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

type Field = { name: string; type: 'text' | 'number' | 'date' };

/** A map of the owner's with one free point layer, written by SQL (no request spent); revision 0. */
async function layerWith(fields: Field[], features: Array<Record<string, unknown>>) {
  const pool = getPool();
  const { rows: maps } = await pool.query<{ id: string }>(
    `INSERT INTO workspace.maps (owner_id, title) VALUES ($1, 'Trường') RETURNING id`, [ids.get(O)]
  );
  const mapId = maps[0].id;
  const { rows: layers } = await pool.query<{ id: string }>(
    `INSERT INTO workspace.map_layers (map_id, kind, title, position, geometry_type, fields)
     VALUES ($1, 'free', 'Điểm', 0, 'point', $2::jsonb) RETURNING id`,
    [mapId, JSON.stringify(fields)]
  );
  const layerId = layers[0].id;
  const featureIds: string[] = [];
  for (const [i, properties] of features.entries()) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO workspace.features (layer_id, geom, properties)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, 16), 4326), $3::jsonb) RETURNING id::text AS id`,
      [layerId, 108 + i * 0.01, JSON.stringify(properties)]
    );
    featureIds.push(rows[0].id);
  }
  return { mapId, layerId, featureIds, url: `/maps/${mapId}/layers/${layerId}` };
}

/** Each feature's properties, in feature order, read straight from the table. */
async function propertiesOf(layerId: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await getPool().query<{ properties: Record<string, unknown> }>(
    `SELECT properties FROM workspace.features WHERE layer_id = $1 ORDER BY id`, [layerId]
  );
  return rows.map((r) => r.properties);
}

async function layerState(layerId: string) {
  const { rows } = await getPool().query<{ fields: Field[]; revision: number }>(
    `SELECT l.fields, m.revision FROM workspace.map_layers l JOIN workspace.maps m ON m.id = l.map_id WHERE l.id = $1`,
    [layerId]
  );
  return rows[0];
}

async function cleanupUsers() {
  // Maps, layers and features go with their owner (ON DELETE CASCADE).
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3c-fields-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanupUsers();
  const repo = usersRepository(getPool());
  for (const who of [O, R]) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role: 'viewer' });
    ids.set(who, row.id);
  }
});

afterAll(async () => {
  await runStages([cleanupUsers, () => app.close()]);
});

describe('free layer fields', () => {
  it('renaming a field moves the key in every feature', async () => {
    const { layerId, url } = await layerWith(
      [{ name: 'ten', type: 'text' }, { name: 'ghi_chu', type: 'text' }, { name: 'so', type: 'number' }],
      [{ ten: 'A', ghi_chu: 'g', so: 1 }, { ten: 'B' }, { so: 2 }, {}]
    );
    const fields = [
      // A swap: each key moves to the other's name, read from the feature as it was.
      { name: 'ghi_chu', type: 'text', from: 'ten' },
      { name: 'ten', type: 'text', from: 'ghi_chu' },
      { name: 'so_luong', type: 'number', from: 'so' },
      { name: 'ngay_do', type: 'date' }, // new: no feature gets the key
    ];

    // A stale revision changes nothing.
    const stale = await call(O, 'PATCH', url, { fields, expectedRevision: 3 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('MAP_CHANGED');
    expect(await propertiesOf(layerId)).toEqual([{ ten: 'A', ghi_chu: 'g', so: 1 }, { ten: 'B' }, { so: 2 }, {}]);

    const res = await call(O, 'PATCH', url, { fields, expectedRevision: 0 });
    expect(res.statusCode).toBe(200);
    const declared = [
      { name: 'ghi_chu', type: 'text' }, { name: 'ten', type: 'text' },
      { name: 'so_luong', type: 'number' }, { name: 'ngay_do', type: 'date' },
    ];
    expect(res.json()).toMatchObject({ revision: 1, layer: { id: layerId, fields: declared, featureCount: 4 } });
    expect(await propertiesOf(layerId)).toEqual([
      { ghi_chu: 'A', ten: 'g', so_luong: 1 }, { ghi_chu: 'B' }, { so_luong: 2 }, {},
    ]);

    // A `from` that the layer does not declare is refused, and nothing changes.
    const unknown = await call(O, 'PATCH', url, {
      fields: [...declared, { name: 'moi', type: 'text', from: 'khong_co' }], expectedRevision: 1,
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Trường "khong_co" không có trong lớp.' });
    // One declared field cannot become two.
    const twice = await call(O, 'PATCH', url, {
      fields: [...declared, { name: 'ten_2', type: 'text', from: 'ten' }], expectedRevision: 1,
    });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error.code).toBe('VALIDATION_ERROR');
    expect(await layerState(layerId)).toEqual({ fields: declared, revision: 1 });
  });

  it('removing a field drops its key', async () => {
    const { layerId, url } = await layerWith(
      [{ name: 'ten', type: 'text' }, { name: 'so', type: 'number' }],
      [{ ten: 'A', so: 1 }, { so: 2 }]
    );
    const res = await call(O, 'PATCH', url, { fields: [{ name: 'ten', type: 'text' }], expectedRevision: 0 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ revision: 1, layer: { fields: [{ name: 'ten', type: 'text' }] } });
    expect(await propertiesOf(layerId)).toEqual([{ ten: 'A' }, {}]);

    // The Fields rules hold here as on create: at most 50, no duplicates, `id` reserved.
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ name: `f${i}`, type: 'text' }));
    for (const fields of [
      tooMany,
      [{ name: 'ten', type: 'text' }, { name: 'TEN', type: 'text' }],
      [{ name: 'id', type: 'number' }],
    ]) {
      const bad = await call(O, 'PATCH', url, { fields, expectedRevision: 1 });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('VALIDATION_ERROR');
    }
    // An empty list removes every field.
    const none = await call(O, 'PATCH', url, { fields: [], expectedRevision: 1 });
    expect(none.statusCode).toBe(200);
    expect(none.json().layer.fields).toEqual([]);
    expect(await propertiesOf(layerId)).toEqual([{}, {}]);
  });

  it('a type change is refused while values exist, allowed when none do', async () => {
    const { layerId, featureIds, url } = await layerWith(
      [{ name: 'so', type: 'number' }, { name: 'ten', type: 'text' }],
      [{ so: 1, ten: 'A' }, { so: null }]
    );
    const toText = [{ name: 'so', type: 'text' }, { name: 'ten', type: 'text' }];
    const refused = await call(O, 'PATCH', url, { fields: toText, expectedRevision: 0 });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatchObject({
      code: 'VALIDATION_ERROR', message: 'Không đổi kiểu được trường "so" vì đã có giá trị.',
    });
    expect(await layerState(layerId)).toEqual({
      fields: [{ name: 'so', type: 'number' }, { name: 'ten', type: 'text' }], revision: 0,
    });

    // Once no feature holds a value for it (null counts as none), the type may change.
    const cleared = await call(O, 'PUT', `${url}/features/${featureIds[0]}`, {
      properties: { so: null, ten: 'A' }, expectedRevision: 0,
    });
    expect(cleared.statusCode).toBe(200);
    const res = await call(O, 'PATCH', url, { fields: toText, expectedRevision: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ revision: 2, layer: { fields: toText } });
    // The new type is the one enforced.
    const write = await call(O, 'PUT', `${url}/features/${featureIds[1]}`, { properties: { so: 'mười' }, expectedRevision: 2 });
    expect(write.statusCode).toBe(200);
  });

  it('fields on an edit copy are refused', async () => {
    const { mapId, layerId, url } = await layerWith([{ name: 'ten', type: 'text' }], []);
    // An edit copy whose draft is gone and a raster layer, as rows: no draft or file is needed
    // to be refused.
    const { rows } = await getPool().query<{ id: string; kind: string }>(
      `INSERT INTO workspace.map_layers (map_id, kind, title, position, layer_key, raster)
       VALUES ($1, 'edit_copy', 'Sửa đập', 1, 'dams', NULL), ($1, 'raster', 'Ảnh', 2, NULL, '{}'::jsonb)
       RETURNING id, kind`,
      [mapId]
    );
    const fields = [{ name: 'ten', type: 'text' }];
    for (const layer of rows) {
      const res = await call(O, 'PATCH', `/maps/${mapId}/layers/${layer.id}`, { fields, expectedRevision: 0 });
      expect(res.statusCode, layer.kind).toBe(400);
      expect(res.json(), layer.kind).toEqual(UNSUPPORTED);
    }
    expect((await layerState(layerId)).revision).toBe(0);

    // On a free layer a recipient is refused as for any write.
    await getPool().query(
      `INSERT INTO workspace.map_shares (map_id, user_id, created_by) VALUES ($1, $2, $3)`,
      [mapId, ids.get(R), ids.get(O)]
    );
    const recipient = await call(R, 'PATCH', url, { fields: [], expectedRevision: 0 });
    expect(recipient.statusCode).toBe(403);
    expect(recipient.json().error).toEqual({ code: 'FORBIDDEN', message: OWNER_ONLY });
    expect(await layerState(layerId)).toEqual({ fields, revision: 0 });
  });
});
