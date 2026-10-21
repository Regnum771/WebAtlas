import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runStages } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const PW = 'p3a-free-pass-123';
const email = (who: string) => `p3a-free-${who}@webatlas.test`;
const O = email('owner');
const R = email('recipient');
const S = email('stranger');
const ids = new Map<string, string>();

const OWNER_ONLY = 'Chỉ người tạo bản đồ được sửa bản đồ này.';
const MAP_CHANGED = 'Bản đồ đã thay đổi ở nơi khác.';
const UNSUPPORTED = 'Loại lớp này chưa hỗ trợ thao tác này.';

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

async function createMap(title = 'Bản đồ thử') {
  const res = await call(O, 'POST', '/maps', { title });
  expect(res.statusCode).toBe(201);
  return res.json().map as { id: string; revision: number };
}
async function revisionOf(mapId: string): Promise<number> {
  const res = await call(O, 'GET', `/maps/${mapId}`);
  return res.json().map.revision;
}
async function addLayer(mapId: string, over: Record<string, unknown> = {}) {
  const res = await call(O, 'POST', `/maps/${mapId}/layers`, {
    kind: 'free', title: 'Điểm đo', geometryType: 'point',
    fields: [{ name: 'ten', type: 'text' }, { name: 'luu_luong', type: 'number' }, { name: 'ngay', type: 'date' }],
    ...over,
    // Only ask for the revision when the caller does not know it: the file stays under the
    // global rate limit (100 requests a minute from one address).
    expectedRevision: 'expectedRevision' in over ? over.expectedRevision : await revisionOf(mapId),
  });
  return res;
}
const pt = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y] });

async function cleanupUsers() {
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3a-free-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanupUsers();
  const repo = usersRepository(getPool());
  for (const [who, name] of [[O, 'Chủ'], [R, 'Người nhận'], [S, 'Người lạ']] as const) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: name, role: 'viewer' });
    ids.set(who, row.id);
  }
});

afterAll(async () => {
  await runStages([cleanupUsers, () => app.close()]);
});

describe('free layers', () => {
  it('owner draws a layer, adds, edits and removes features; each write bumps the revision', async () => {
    const map = await createMap();
    const created = await addLayer(map.id, { expectedRevision: 0 });
    expect(created.statusCode).toBe(201);
    const { layer, revision } = created.json();
    expect(revision).toBe(1);
    expect(layer).toMatchObject({ kind: 'free', title: 'Điểm đo', position: 0, geometryType: 'point', featureCount: 0, style: {}, raster: null });
    const base = `/maps/${map.id}/layers/${layer.id}`;

    const added = await call(O, 'POST', `${base}/features`, {
      geometry: pt(105, 20), properties: { ten: 'A', luu_luong: 3.5, ngay: '2026-10-20' }, expectedRevision: 1,
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().revision).toBe(2);
    const feature = added.json().feature;
    expect(typeof feature.id).toBe('string');
    expect(feature).toMatchObject({ type: 'Feature', geometry: pt(105, 20), properties: { ten: 'A', luu_luong: 3.5 } });

    const edited = await call(O, 'PUT', `${base}/features/${feature.id}`, {
      geometry: pt(106, 21), properties: { ten: 'B', luu_luong: null }, expectedRevision: 2,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().revision).toBe(3);
    expect(edited.json().feature).toMatchObject({ id: feature.id, geometry: pt(106, 21), properties: { ten: 'B', luu_luong: null } });

    const read = await call(O, 'GET', `${base}/features`);
    expect(read.json()).toMatchObject({ type: 'FeatureCollection', truncated: false });
    expect(read.json().features).toHaveLength(1);

    const restyled = await call(O, 'PATCH', base, { title: 'Đổi tên', style: { color: '#f00' }, expectedRevision: 3 });
    expect(restyled.statusCode).toBe(200);
    expect(restyled.json()).toMatchObject({ revision: 4, layer: { title: 'Đổi tên', style: { color: '#f00' }, featureCount: 1 } });

    const removed = await call(O, 'DELETE', `${base}/features/${feature.id}`, { expectedRevision: 4 });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ revision: 5 });

    const gone = await call(O, 'DELETE', base, { expectedRevision: 5 });
    expect(gone.json()).toEqual({ revision: 6 });
    expect((await call(O, 'GET', `/maps/${map.id}`)).json().map.layers).toEqual([]);
  });

  it('a stale revision changes nothing', async () => {
    const map = await createMap();
    const { layer, revision } = (await addLayer(map.id, { expectedRevision: 0 })).json();
    const url = `/maps/${map.id}/layers/${layer.id}/features`;
    const first = await call(O, 'POST', url, { geometry: pt(1, 1), properties: {}, expectedRevision: revision });
    expect(first.statusCode).toBe(201);
    const second = await call(O, 'POST', url, { geometry: pt(2, 2), properties: {}, expectedRevision: revision });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({ code: 'MAP_CHANGED', message: MAP_CHANGED });
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM workspace.features WHERE layer_id = $1`, [layer.id]);
    expect(rows[0].n).toBe(1);
  });

  it('geometry type and field types are enforced', async () => {
    const map = await createMap();
    const { layer } = (await addLayer(map.id)).json();
    const url = `/maps/${map.id}/layers/${layer.id}/features`;
    let rev = await revisionOf(map.id);
    const bad = async (body: Record<string, unknown>, message: string, field: string) => {
      const res = await call(O, 'POST', url, { expectedRevision: rev, properties: {}, ...body });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message, details: { field } });
    };
    await bad({ geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }, 'Lớp này chỉ nhận đối tượng dạng điểm.', 'geometry');
    await bad({ geometry: pt(1, 1), properties: { la: 1 } }, 'Trường "la" không có trong lớp.', 'la');
    await bad({ geometry: pt(1, 1), properties: { ten: 5 } }, 'Trường "ten" phải là chữ.', 'ten');
    await bad({ geometry: pt(1, 1), properties: { luu_luong: '5' } }, 'Trường "luu_luong" phải là số.', 'luu_luong');
    await bad({ geometry: pt(1, 1), properties: { ngay: '2026-13-40' } }, 'Trường "ngay" phải là ngày.', 'ngay');
    await bad({ geometry: pt(1, 1), properties: { ngay: '20/10/2026' } }, 'Trường "ngay" phải là ngày.', 'ngay');

    // null is allowed for every type
    const ok = await call(O, 'POST', url, { geometry: pt(1, 1), properties: { ten: null, luu_luong: null, ngay: null }, expectedRevision: rev });
    expect(ok.statusCode).toBe(201);
    rev = ok.json().revision;

    // line and polygon layers name their own word
    const line = (await addLayer(map.id, { title: 'Đường', geometryType: 'line', fields: [], expectedRevision: rev })).json();
    const poly = (await addLayer(map.id, { title: 'Vùng', geometryType: 'polygon', fields: [], expectedRevision: line.revision })).json();
    expect(poly.layer.position).toBe(2);
    const onPoly = await call(O, 'POST', `/maps/${map.id}/layers/${poly.layer.id}/features`, { geometry: pt(1, 1), expectedRevision: poly.revision });
    expect(onPoly.json().error.message).toBe('Lớp này chỉ nhận đối tượng dạng vùng.');
    const onLine = await call(O, 'POST', `/maps/${map.id}/layers/${line.layer.id}/features`, { geometry: pt(1, 1), expectedRevision: poly.revision });
    expect(onLine.json().error.message).toBe('Lớp này chỉ nhận đối tượng dạng đường.');
    // fields = [] accepts any properties
    const any = await call(O, 'POST', `/maps/${map.id}/layers/${line.layer.id}/features`, {
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { bat_ky: [1] }, expectedRevision: poly.revision,
    });
    expect(any.statusCode).toBe(201);
  });

  it('layer definitions are validated', async () => {
    const map = await createMap();
    const dup = await addLayer(map.id, { fields: [{ name: 'A', type: 'text' }, { name: ' a ', type: 'number' }], expectedRevision: 0 });
    expect(dup.statusCode).toBe(400);
    expect((await addLayer(map.id, { fields: [{ name: 'id', type: 'text' }], expectedRevision: 0 })).statusCode).toBe(400);
    expect((await addLayer(map.id, { fields: [{ name: 'x', type: 'boolean' }], expectedRevision: 0 })).statusCode).toBe(400);
    const big = await addLayer(map.id, { style: { blob: 'x'.repeat(9000) }, expectedRevision: 0 });
    expect(big.statusCode).toBe(400);
    expect(big.json().error).toMatchObject({ message: 'Kiểu hiển thị quá lớn.', details: { field: 'style' } });
    const other = await call(O, 'POST', `/maps/${map.id}/layers`, { kind: 'raster', title: 'x', expectedRevision: 0 });
    expect(other.statusCode).toBe(400);
    expect(other.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message: UNSUPPORTED });
  });

  it('invalid geometry is 422 and writes nothing', async () => {
    const map = await createMap();
    const { layer, revision } = (await addLayer(map.id, { geometryType: 'polygon', fields: [], expectedRevision: 0 })).json();
    const bowtie = { type: 'Polygon', coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]] };
    const res = await call(O, 'POST', `/maps/${map.id}/layers/${layer.id}/features`, { geometry: bowtie, properties: {}, expectedRevision: revision });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('GEOMETRY_ERROR');
    expect(await revisionOf(map.id)).toBe(revision);
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM workspace.features WHERE layer_id = $1`, [layer.id]);
    expect(rows[0].n).toBe(0);
  });

  it('a 3D point is stored without its altitude; an empty geometry is 422 and writes nothing', async () => {
    const map = await createMap();
    const { layer, revision } = (await addLayer(map.id, { fields: [], expectedRevision: 0 })).json();
    const url = `/maps/${map.id}/layers/${layer.id}/features`;

    const added = await call(O, 'POST', url, { geometry: { type: 'Point', coordinates: [105, 20, 12.5] }, properties: {}, expectedRevision: revision });
    expect(added.statusCode).toBe(201);
    expect(added.json().feature.geometry).toEqual(pt(105, 20));
    const moved = await call(O, 'PUT', `${url}/${added.json().feature.id}`, {
      geometry: { type: 'Point', coordinates: [106, 21, 30] }, expectedRevision: added.json().revision,
    });
    expect(moved.statusCode).toBe(200);
    const read = await call(O, 'GET', url);
    expect(read.json().features.map((f: { geometry: unknown }) => f.geometry)).toEqual([pt(106, 21)]);

    const rev = moved.json().revision;
    const empty = await call(O, 'POST', url, { geometry: { type: 'MultiPoint', coordinates: [] }, properties: {}, expectedRevision: rev });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error).toMatchObject({ code: 'GEOMETRY_ERROR', message: 'Hình dạng của đối tượng đang trống.' });
    const stored = await getPool().query(
      `SELECT m.revision, (SELECT count(*)::int FROM workspace.features WHERE layer_id = $2) AS n
         FROM workspace.maps m WHERE m.id = $1`,
      [map.id, layer.id]
    );
    expect(stored.rows[0]).toEqual({ revision: rev, n: 1 });
  });

  it('bbox filters and limit truncates', async () => {
    const map = await createMap();
    const { layer } = (await addLayer(map.id, { fields: [], expectedRevision: 0 })).json();
    const url = `/maps/${map.id}/layers/${layer.id}/features`;
    for (const [x, y] of [[1, 1], [2, 2], [50, 50]]) {
      const res = await call(O, 'POST', url, { geometry: pt(x, y), properties: {}, expectedRevision: await revisionOf(map.id) });
      expect(res.statusCode).toBe(201);
    }
    const inBox = await call(O, 'GET', `${url}?bbox=0,0,10,10`);
    expect(inBox.json().features).toHaveLength(2);
    expect(inBox.json().truncated).toBe(false);
    const limited = await call(O, 'GET', `${url}?limit=1`);
    expect(limited.json().features).toHaveLength(1);
    expect(limited.json().truncated).toBe(true);
    expect((await call(O, 'GET', `${url}?bbox=1,2,3`)).statusCode).toBe(400);
  });

  it('a recipient reads features but cannot add; a stranger gets 404', async () => {
    const map = await createMap();
    const { layer, revision } = (await addLayer(map.id, { expectedRevision: 0 })).json();
    await getPool().query(
      `INSERT INTO workspace.map_shares (map_id, user_id, created_by) VALUES ($1, $2, $3)`,
      [map.id, ids.get(R), ids.get(O)]
    );
    const url = `/maps/${map.id}/layers/${layer.id}/features`;
    expect((await call(R, 'GET', url)).statusCode).toBe(200);
    const add = await call(R, 'POST', url, { geometry: pt(1, 1), properties: {}, expectedRevision: revision });
    expect(add.statusCode).toBe(403);
    expect(add.json().error.message).toBe(OWNER_ONLY);

    const stranger = await call(S, 'GET', url);
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json().error.message).toBe('Không tìm thấy bản đồ.');
    // A stranger gets the same answer for a layer that does not exist in the map.
    const ghost = await call(S, 'GET', `/maps/${map.id}/layers/00000000-0000-4000-8000-000000000000/features`);
    expect(ghost.json()).toEqual(stranger.json());
  });

  it('a layer of another map is 404', async () => {
    const a = await createMap('A');
    const b = await createMap('B');
    const { layer } = (await addLayer(a.id)).json();
    const rev = await revisionOf(b.id);
    const url = `/maps/${b.id}/layers/${layer.id}`;
    expect((await call(O, 'GET', `${url}/features`)).statusCode).toBe(404);
    expect((await call(O, 'POST', `${url}/features`, { geometry: pt(1, 1), expectedRevision: rev })).statusCode).toBe(404);
    expect((await call(O, 'PATCH', url, { title: 'x', expectedRevision: rev })).statusCode).toBe(404);
    expect((await call(O, 'DELETE', url, { expectedRevision: rev })).statusCode).toBe(404);
    // A feature id that is not in the layer is 404 too.
    const own = (await call(O, 'POST', `/maps/${a.id}/layers`, {
      kind: 'free', title: 'L2', geometryType: 'point', fields: [], expectedRevision: await revisionOf(a.id),
    })).json().layer;
    const f = (await call(O, 'POST', `/maps/${a.id}/layers/${layer.id}/features`, {
      geometry: pt(1, 1), expectedRevision: await revisionOf(a.id),
    })).json().feature;
    const wrong = await call(O, 'DELETE', `/maps/${a.id}/layers/${own.id}/features/${f.id}`, { expectedRevision: await revisionOf(a.id) });
    expect(wrong.statusCode).toBe(404);
  });

  it('reordering layers keeps positions unique', async () => {
    const map = await createMap();
    const ids3: string[] = [];
    for (const title of ['L0', 'L1', 'L2']) {
      const res = await addLayer(map.id, { title, fields: [] });
      expect(res.statusCode).toBe(201);
      ids3.push(res.json().layer.id);
    }
    const move = await call(O, 'PATCH', `/maps/${map.id}/layers/${ids3[2]}`, { position: 0, expectedRevision: await revisionOf(map.id) });
    expect(move.statusCode).toBe(200);
    const order = async () =>
      (await call(O, 'GET', `/maps/${map.id}`)).json().map.layers.map((l: { title: string; position: number }) => `${l.position}:${l.title}`);
    expect(await order()).toEqual(['0:L2', '1:L0', '2:L1']);
    await call(O, 'PATCH', `/maps/${map.id}/layers/${ids3[2]}`, { position: 99, expectedRevision: await revisionOf(map.id) });
    expect(await order()).toEqual(['0:L0', '1:L1', '2:L2']);
    await call(O, 'DELETE', `/maps/${map.id}/layers/${ids3[0]}`, { expectedRevision: await revisionOf(map.id) });
    expect(await order()).toEqual(['0:L1', '1:L2']);
  });
});
