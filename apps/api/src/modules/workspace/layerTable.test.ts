import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { discardDraft } from '@webatlas/versioning';
import { runStages } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

// The layer table query (POST .../layers/:layerId/query) run for real, on every personal layer
// kind: a drawn free layer (declared fields), an imported one (no declared fields) and an edit
// copy of an official layer.

const app = buildApp();
const PW = 'p3d-table-pass-123';
const email = (who: string) => `p3d-table-${who}@webatlas.test`;
const O = email('owner');
const R = email('recipient');
const S = email('stranger');
const ids = new Map<string, string>();

// Each user calls from an address of its own, as separate clients would.
const ADDRESS: Record<string, string> = { [O]: '10.0.3.1', [R]: '10.0.3.2', [S]: '10.0.3.3' };

const MAP_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Không tìm thấy bản đồ.' } };
const UNSUPPORTED = { error: { code: 'VALIDATION_ERROR', message: 'Loại lớp này chưa hỗ trợ thao tác này.' } };

// One login per user for the whole file: /api/auth/login allows 10 per minute.
const tokens = new Map<string, string>();
async function tokenFor(who: string) {
  const cached = tokens.get(who);
  if (cached) return cached;
  const res = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { email: who, password: PW }, remoteAddress: ADDRESS[who],
  });
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
    remoteAddress: ADDRESS[who],
    ...(payload ? { payload } : {}),
  });
}

type Column = { name: string; type: 'text' | 'number' | 'date' };
type Row = { id: string; properties: Record<string, unknown>; bbox: [number, number, number, number] | null };
type Answer = { columns: Column[]; total: number; matched: number; rows: Row[]; position: number | null };

async function query(layer: { mapId: string; layerId: string }, body: Record<string, unknown>, who = O): Promise<Answer> {
  const res = await call(who, 'POST', `/maps/${layer.mapId}/layers/${layer.layerId}/query`, body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Answer;
}

/** A map of the owner's, written by SQL (no request spent). */
async function newMap(title = 'Bảng đối tượng'): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO workspace.maps (owner_id, title) VALUES ($1, $2) RETURNING id`, [ids.get(O), title]
  );
  return rows[0].id;
}

/**
 * A free layer with `fields` declared (none: an imported layer) and one feature per entry, each
 * a point unless `wkt` is given. Returns the ids and a label per feature id, by SQL.
 */
async function freeLayer(
  fields: Column[],
  features: Array<{ label: string; properties: Record<string, unknown>; wkt?: string }>,
  mapId?: string
) {
  const pool = getPool();
  const map = mapId ?? (await newMap());
  const { rows: layers } = await pool.query<{ id: string }>(
    `INSERT INTO workspace.map_layers (map_id, kind, title, position, geometry_type, fields)
     VALUES ($1, 'free', 'Lớp', (SELECT count(*) FROM workspace.map_layers WHERE map_id = $1), 'point', $2::jsonb)
     RETURNING id`,
    [map, JSON.stringify(fields)]
  );
  const labels = new Map<string, string>();
  const idOf = new Map<string, string>();
  for (const [i, f] of features.entries()) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO workspace.features (layer_id, geom, properties)
       VALUES ($1, ST_SetSRID(COALESCE(ST_GeomFromText($2), ST_MakePoint($3, 16)), 4326), $4::jsonb)
       RETURNING id::text AS id`,
      [layers[0].id, f.wkt ?? null, 108 + i * 0.01, JSON.stringify(f.properties)]
    );
    labels.set(rows[0].id, f.label);
    idOf.set(f.label, rows[0].id);
  }
  return { mapId: map, layerId: layers[0].id, labels, idOf };
}

/** The labels of an answer's rows, in the answer's order. */
const labelsOf = (answer: Answer, labels: Map<string, string>) => answer.rows.map((r) => labels.get(r.id) ?? `?${r.id}`);
const sorted = (xs: string[]) => [...xs].sort();

async function cleanupUsers() {
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3d-table-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanupUsers();
  const repo = usersRepository(getPool());
  for (const who of [O, R, S]) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role: 'viewer' });
    ids.set(who, row.id);
  }
});

afterAll(async () => {
  const pool = getPool();
  const userIds = [...ids.values()];
  let drafts: string[] = [];
  await runStages([
    async () => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM app.dataset_versions WHERE ingested_by = ANY($1::uuid[]) AND draft_status IS NOT NULL`,
        [userIds]
      );
      drafts = rows.map((r) => r.id);
    },
    () => pool.query(`DELETE FROM workspace.maps WHERE owner_id = ANY($1::uuid[])`, [userIds]),
    async () => {
      for (const id of drafts) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await discardDraft(c, id);
          await c.query('COMMIT');
        } finally {
          await c.query('ROLLBACK').catch(() => {});
          c.release();
        }
      }
    },
    // audit_log.user_id is ON DELETE SET NULL: delete the audit rows before their users.
    () => pool.query(`DELETE FROM app.audit_log WHERE user_id = ANY($1::uuid[])`, [userIds]),
    cleanupUsers,
    () => app.close(),
  ]);
});

// The same four features as a drawn layer (declared fields) and as an imported one (none).
const DRAWN_FIELDS: Column[] = [
  { name: 'ten', type: 'text' }, { name: 'loai', type: 'text' },
  { name: 'cong_suat', type: 'number' }, { name: 'ngay', type: 'date' },
];
const FEATURES = [
  { label: 'A', properties: { ten: 'Đập Hòa Bình', loai: 'thuy_dien', cong_suat: 1920, ngay: '1994-12-20' } },
  { label: 'B', properties: { ten: 'Đập Sơn La', loai: 'thuy_dien', cong_suat: 2400, ngay: '2012-12-23' } },
  { label: 'C', properties: { ten: 'Hồ Kẻ Gỗ', loai: 'thuy_loi', ngay: '' } },
  { label: 'D', properties: { ten: '', loai: 'thuy_loi', cong_suat: 50 } },
];

type Case = [field: string, op: string, value: string | number | undefined, expected: string[]];
const TEXT_CASES: Case[] = [
  ['ten', 'contains', 'son', ['B']],
  ['loai', 'eq', 'thuy_loi', ['C', 'D']],
  ['loai', 'neq', 'thuy_loi', ['A', 'B']],
  ['ten', 'empty', undefined, ['D']],
  ['ten', 'notEmpty', undefined, ['A', 'B', 'C']],
];
const NUMBER_CASES: Case[] = [
  ['cong_suat', 'eq', 50, ['D']],
  ['cong_suat', 'neq', '50', ['A', 'B']],
  ['cong_suat', 'lt', 2000, ['A', 'D']],
  ['cong_suat', 'lte', 1920, ['A', 'D']],
  ['cong_suat', 'gt', 1920, ['B']],
  ['cong_suat', 'gte', 1920, ['A', 'B']],
  ['cong_suat', 'empty', undefined, ['C']],
  ['cong_suat', 'notEmpty', undefined, ['A', 'B', 'D']],
];
const DATE_CASES: Case[] = [
  ['ngay', 'eq', '2012-12-23', ['B']],
  ['ngay', 'neq', '2012-12-23', ['A']],
  ['ngay', 'lt', '2000-01-01', ['A']],
  ['ngay', 'lte', '1994-12-20', ['A']],
  ['ngay', 'gt', '1994-12-20', ['B']],
  ['ngay', 'gte', '1994-12-20', ['A', 'B']],
  ['ngay', 'empty', undefined, ['C', 'D']],
  ['ngay', 'notEmpty', undefined, ['A', 'B']],
];

async function expectCases(
  layer: { mapId: string; layerId: string; labels: Map<string, string> }, cases: Case[], base: Array<Record<string, unknown>> = []
) {
  for (const [field, op, value, expected] of cases) {
    const answer = await query(layer, { conditions: [...base, { field, op, ...(value === undefined ? {} : { value }) }] });
    expect(sorted(labelsOf(answer, layer.labels)), `${field} ${op} ${String(value)}`).toEqual(expected);
    expect(answer.matched, `${field} ${op} ${String(value)}`).toBe(expected.length);
  }
}

/** An edit copy of an official layer, made through the API as the web app makes it. */
async function editCopy(layerKey: string) {
  const mapId = await newMap('Sửa lớp');
  const res = await call(O, 'POST', `/maps/${mapId}/layers`, { kind: 'edit_copy', layerKey, expectedRevision: 0 });
  expect(res.statusCode, res.body).toBe(201);
  return { mapId, layerId: (res.json().layer as { id: string }).id, revision: res.json().revision as number };
}

describe('layer table query', () => {
  it('each operator filters a drawn layer, an imported layer and an edit copy', async () => {
    const drawn = await freeLayer(DRAWN_FIELDS, FEATURES);
    expect((await query(drawn, {})).columns).toEqual(DRAWN_FIELDS);
    await expectCases(drawn, [...TEXT_CASES, ...NUMBER_CASES, ...DATE_CASES]);
    // Several conditions: all of them, or any of them.
    const all = await query(drawn, {
      conditions: [{ field: 'loai', op: 'eq', value: 'thuy_dien' }, { field: 'cong_suat', op: 'gt', value: 2000 }],
    });
    expect(labelsOf(all, drawn.labels)).toEqual(['B']);
    const any = await query(drawn, {
      match: 'any',
      conditions: [{ field: 'ten', op: 'contains', value: 'kẻ' }, { field: 'cong_suat', op: 'eq', value: 50 }],
    });
    expect(sorted(labelsOf(any, drawn.labels))).toEqual(['C', 'D']);

    // Imported: the columns come from the rows; `ngay` is text there, so it takes the text operators.
    const imported = await freeLayer([], FEATURES);
    expect((await query(imported, {})).columns).toEqual([
      { name: 'cong_suat', type: 'number' }, { name: 'loai', type: 'text' },
      { name: 'ngay', type: 'text' }, { name: 'ten', type: 'text' },
    ]);
    await expectCases(imported, [
      ...TEXT_CASES, ...NUMBER_CASES,
      ['ngay', 'contains', '2012', ['B']],
      ['ngay', 'empty', undefined, ['C', 'D']],
    ]);

    // An edit copy of dams, with three features of its own; the tag keeps the official dams out.
    const TAG = 'p3dtable';
    const ec = await editCopy('dams');
    const labels = new Map<string, string>();
    let revision = ec.revision;
    const add = async (label: string, x: number, properties: Record<string, unknown>) => {
      const res = await call(O, 'POST', `/maps/${ec.mapId}/layers/${ec.layerId}/features`, {
        geometry: { type: 'Point', coordinates: [x, 16.02] }, properties, expectedRevision: revision,
      });
      expect(res.statusCode, res.body).toBe(201);
      revision = res.json().revision;
      labels.set(res.json().feature.id, label);
    };
    await add('A', 108.11, { name: `${TAG} Đập Một`, status: 'van_hanh', wattage_mw: 100 });
    await add('B', 108.12, { name: `${TAG} Đập Hai`, status: 'xay_dung', wattage_mw: 250 });
    await add('C', 108.13, { name: `${TAG} Hồ Ba` });
    const edit = { ...ec, labels };
    const cols = (await query(edit, {})).columns;
    expect(cols).toEqual([
      { name: 'name', type: 'text' }, { name: 'name_en', type: 'text' }, { name: 'wattage_mw', type: 'number' },
      { name: 'annual_output', type: 'number' }, { name: 'year_launched', type: 'text' },
      { name: 'year_operational', type: 'text' }, { name: 'status', type: 'text' }, { name: 'managing_unit', type: 'text' },
    ]);
    await expectCases(edit, [
      ['status', 'contains', 'van', ['A']],
      ['status', 'eq', 'xay_dung', ['B']],
      ['status', 'neq', 'xay_dung', ['A', 'C']],
      ['status', 'empty', undefined, ['C']],
      ['status', 'notEmpty', undefined, ['A', 'B']],
      ['wattage_mw', 'eq', 100, ['A']],
      ['wattage_mw', 'neq', 100, ['B']],
      ['wattage_mw', 'lt', 250, ['A']],
      ['wattage_mw', 'lte', 250, ['A', 'B']],
      ['wattage_mw', 'gt', 100, ['B']],
      ['wattage_mw', 'gte', 100, ['A', 'B']],
      ['wattage_mw', 'empty', undefined, ['C']],
      ['wattage_mw', 'notEmpty', undefined, ['A', 'B']],
    ], [{ field: 'name', op: 'contains', value: TAG }]);

    // An unknown field is refused, after the access check.
    const unknown = await call(O, 'POST', `/maps/${drawn.mapId}/layers/${drawn.layerId}/query`, {
      conditions: [{ field: 'khong_co', op: 'eq', value: 'x' }],
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.message).toBe('Trường "khong_co" không có trong lớp này.');
  }, 60_000);

  it('the search box ignores diacritics: "dap" finds "Đập"', async () => {
    const drawn = await freeLayer(DRAWN_FIELDS, FEATURES);
    expect(sorted(labelsOf(await query(drawn, { q: 'dap' }), drawn.labels))).toEqual(['A', 'B']);
    expect(sorted(labelsOf(await query(drawn, { q: 'HO' }), drawn.labels))).toEqual(['A', 'C']);
    // Numbers are not searched: the search box looks in text columns only.
    expect(labelsOf(await query(drawn, { q: '2400' }), drawn.labels)).toEqual([]);
  });

  it('a column with any non-number value is typed text', async () => {
    const layer = await freeLayer([], [
      { label: 'A', properties: { so: 1, gia: 1, ma: '1', rong: null } },
      { label: 'B', properties: { so: 2, gia: 2.5, ma: '2', rong: null } },
      { label: 'C', properties: { so: 'N/A', gia: null, ma: '3' } },
      { label: 'D', properties: { so: '1.200,5', gia: -3 } },
    ]);
    const answer = await query(layer, {});
    expect(answer.columns).toEqual([
      { name: 'gia', type: 'number' }, { name: 'ma', type: 'text' },
      { name: 'rong', type: 'text' }, { name: 'so', type: 'text' },
    ]);
    // A number operator on the text column is refused; text operators work on it.
    const refused = await call(O, 'POST', `/maps/${layer.mapId}/layers/${layer.layerId}/query`, {
      conditions: [{ field: 'so', op: 'gt', value: 1 }],
    });
    expect(refused.statusCode).toBe(400);
    expect(labelsOf(await query(layer, { conditions: [{ field: 'so', op: 'eq', value: 'N/A' }] }), layer.labels)).toEqual(['C']);
    // The number column sorts as numbers: -3, 1, 2.5, then the missing value.
    const bySize = await query(layer, { sort: { field: 'gia', dir: 'asc' } });
    expect(labelsOf(bySize, layer.labels)).toEqual(['D', 'A', 'B', 'C']);
  });

  it('a column named with quotes and spaces filters and sorts', async () => {
    const KEY = 'Tên đập';
    const QUOTE = "a'b";
    const EVIL = 'x"; DROP TABLE t;--';
    const layer = await freeLayer([], [
      { label: 'A', properties: { [KEY]: 'b', [QUOTE]: 'một', [EVIL]: 1 } },
      { label: 'B', properties: { [KEY]: '', [QUOTE]: 'hai', [EVIL]: 2 } },
      { label: 'C', properties: { [KEY]: 'a', [QUOTE]: "o'neil", [EVIL]: 3 } },
      { label: 'D', properties: { [QUOTE]: 'bốn' } },
    ]);
    const answer = await query(layer, {});
    // Sorted by name, character by character.
    expect(answer.columns).toEqual([{ name: KEY, type: 'text' }, { name: QUOTE, type: 'text' }, { name: EVIL, type: 'number' }]);

    expect(labelsOf(await query(layer, { conditions: [{ field: QUOTE, op: 'eq', value: "o'neil" }] }), layer.labels)).toEqual(['C']);
    expect(sorted(labelsOf(await query(layer, { conditions: [{ field: EVIL, op: 'gte', value: 2 }] }), layer.labels))).toEqual(['B', 'C']);
    expect(labelsOf(await query(layer, { q: "o'n" }), layer.labels)).toEqual(['C']);
    // Sorted on the key with spaces: a, b, then the empty and the missing value last (by id).
    expect(labelsOf(await query(layer, { sort: { field: KEY, dir: 'asc' } }), layer.labels)).toEqual(['C', 'A', 'B', 'D']);
    expect(labelsOf(await query(layer, { sort: { field: KEY, dir: 'desc' } }), layer.labels)).toEqual(['A', 'C', 'B', 'D']);
    expect(labelsOf(await query(layer, { sort: { field: EVIL, dir: 'desc' } }), layer.labels)).toEqual(['C', 'B', 'A', 'D']);
    // The features table is still there.
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM workspace.features WHERE layer_id = $1`, [layer.layerId]);
    expect(rows[0].n).toBe(4);
  });

  it('total, matched and paging agree', async () => {
    const layer = await freeLayer(
      [{ name: 'n', type: 'number' }, { name: 'chan', type: 'text' }],
      Array.from({ length: 25 }, (_, n) => ({ label: String(n), properties: { n, chan: n % 2 === 0 ? 'chan' : 'le' } }))
    );
    const body = { conditions: [{ field: 'chan', op: 'eq', value: 'chan' }], sort: { field: 'n', dir: 'desc' } };
    const first = await query(layer, { ...body, offset: 0, limit: 5 });
    expect(first).toMatchObject({ total: 25, matched: 13, position: null });
    expect(labelsOf(first, layer.labels)).toEqual(['24', '22', '20', '18', '16']);
    const second = await query(layer, { ...body, offset: 5, limit: 5 });
    expect(labelsOf(second, layer.labels)).toEqual(['14', '12', '10', '8', '6']);
    const last = await query(layer, { ...body, offset: 10, limit: 5 });
    expect(labelsOf(last, layer.labels)).toEqual(['4', '2', '0']);
    const past = await query(layer, { ...body, offset: 20, limit: 5 });
    expect(past).toMatchObject({ total: 25, matched: 13, rows: [] });
    // With no filter and no sort: every feature, in id order.
    const plain = await query(layer, { limit: 500 });
    expect(plain).toMatchObject({ total: 25, matched: 25 });
    expect(labelsOf(plain, layer.labels)).toEqual(Array.from({ length: 25 }, (_, n) => String(n)));
    // A filter that matches nothing.
    expect(await query(layer, { conditions: [{ field: 'chan', op: 'eq', value: 'khong' }] })).toMatchObject({
      total: 25, matched: 0, rows: [], position: null,
    });
  });

  it('locate returns the position, and null when the filter hides the feature', async () => {
    const layer = await freeLayer(
      [{ name: 'n', type: 'number' }, { name: 'chan', type: 'text' }],
      Array.from({ length: 25 }, (_, n) => ({ label: String(n), properties: { n, chan: n % 2 === 0 ? 'chan' : 'le' } }))
    );
    const body = { conditions: [{ field: 'chan', op: 'eq', value: 'chan' }], sort: { field: 'n', dir: 'desc' }, limit: 5 };
    // 24, 22, 20, 18, 16, 14, 12, 10: n = 10 is at index 7, on the second page.
    expect((await query(layer, { ...body, locate: layer.idOf.get('10') })).position).toBe(7);
    expect((await query(layer, { ...body, locate: layer.idOf.get('24') })).position).toBe(0);
    expect((await query(layer, { ...body, locate: layer.idOf.get('11') })).position).toBeNull();
    expect((await query(layer, { ...body, locate: 'khong-co' })).position).toBeNull();
    expect((await query(layer, body)).position).toBeNull();
  });

  it('rows carry their bbox', async () => {
    const layer = await freeLayer([{ name: 'ten', type: 'text' }], [
      { label: 'diem', properties: { ten: 'điểm' }, wkt: 'POINT(108.2 16.05)' },
      { label: 'duong', properties: { ten: 'đường' }, wkt: 'LINESTRING(108 16, 108.5 16.25)' },
      { label: 'xa', properties: { ten: 'xa' }, wkt: 'POINT(105.8 21)' },
    ]);
    const answer = await query(layer, {});
    const bboxOf = (label: string) => answer.rows.find((r) => layer.labels.get(r.id) === label)?.bbox;
    expect(bboxOf('diem')).toEqual([108.2, 16.05, 108.2, 16.05]);
    expect(bboxOf('duong')).toEqual([108, 16, 108.5, 16.25]);
    // The "in view" box keeps the rows whose geometry meets it.
    const inView = await query(layer, { bbox: [107.9, 15.9, 108.3, 16.1] });
    expect(sorted(labelsOf(inView, layer.labels))).toEqual(['diem', 'duong']);
    expect(inView).toMatchObject({ total: 3, matched: 2 });

    // An edit copy's rows carry their bbox too, and the box filters them.
    const ec = await editCopy('dams');
    const added = await call(O, 'POST', `/maps/${ec.mapId}/layers/${ec.layerId}/features`, {
      geometry: { type: 'Point', coordinates: [108.14, 16.03] }, properties: { name: 'p3dtable bbox' }, expectedRevision: ec.revision,
    });
    expect(added.statusCode, added.body).toBe(201);
    const id = added.json().feature.id as string;
    const ecAnswer = await query(ec, { q: 'p3dtable bbox', bbox: [108.135, 16.025, 108.145, 16.035] });
    expect(ecAnswer.rows).toEqual([expect.objectContaining({ id, bbox: [108.14, 16.03, 108.14, 16.03] })]);
    expect(ecAnswer.rows[0].properties).toMatchObject({ name: 'p3dtable bbox' });
  });

  it('a recipient may query; a stranger gets the map 404', async () => {
    const layer = await freeLayer(DRAWN_FIELDS, FEATURES);
    await getPool().query(`INSERT INTO workspace.map_shares (map_id, user_id) VALUES ($1, $2)`, [layer.mapId, ids.get(R)]);
    const shared = await query(layer, { q: 'dap' }, R);
    expect(sorted(labelsOf(shared, layer.labels))).toEqual(['A', 'B']);

    const url = `/maps/${layer.mapId}/layers/${layer.layerId}/query`;
    const stranger = await call(S, 'POST', url, { q: 'dap' });
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json()).toEqual(MAP_NOT_FOUND);
    // The same answer as for a map that does not exist.
    const missing = await call(S, 'POST', `/maps/${randomUUID()}/layers/${layer.layerId}/query`, { q: 'dap' });
    expect(missing.json()).toEqual(stranger.json());
    // A layer that is not in the map: the layer's 404.
    const otherLayer = await call(O, 'POST', `/maps/${layer.mapId}/layers/${randomUUID()}/query`, {});
    expect(otherLayer.statusCode).toBe(404);
    expect(otherLayer.json().error.message).toBe('Không tìm thấy lớp.');
  });

  it('a raster layer is refused', async () => {
    const mapId = await newMap('Ảnh');
    const owner = ids.get(O)!;
    const cogId = randomUUID();
    await getPool().query(
      `INSERT INTO workspace.files (id, owner_id, kind, path, original_name, content_type, size_bytes)
       VALUES ($1, $2, 'cog', $3, 'anh.tif', 'image/tiff', 1)`,
      [cogId, owner, `cog/${owner}/${cogId}.tif`]
    );
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO workspace.map_layers (map_id, kind, title, position, file_id, raster)
       VALUES ($1, 'raster', 'Ảnh', 0, $2, '{}'::jsonb) RETURNING id`,
      [mapId, cogId]
    );
    const res = await call(O, 'POST', `/maps/${mapId}/layers/${rows[0].id}/query`, {});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(UNSUPPORTED);
  });

  it('a filtered, sorted page of a rivers edit copy returns within 1.5 s', async () => {
    const ec = await editCopy('rivers');
    const body = {
      conditions: [{ field: 'name', op: 'contains', value: 'a' }],
      sort: { field: 'name', dir: 'asc' }, offset: 0, limit: 100,
    };
    const started = performance.now();
    const answer = await query(ec, body);
    const elapsed = performance.now() - started;
    console.info(`rivers edit copy: ${answer.total} rows, ${answer.matched} matched, page in ${Math.round(elapsed)} ms`);
    expect(answer.total).toBeGreaterThan(1000);
    expect(answer.rows).toHaveLength(100);
    // Every name contains "a", diacritics ignored ("Sông Đà" counts).
    const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    expect(answer.rows.every((r) => fold(String(r.properties.name)).includes('a'))).toBe(true);
    expect(elapsed).toBeLessThan(1500);
  }, 30_000);
});
