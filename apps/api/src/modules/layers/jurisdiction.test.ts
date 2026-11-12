import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { refreshCurrentRows } from '@webatlas/versioning';

const app = buildApp();
const PW = 'juris-pass-123';
const P = 'juris-province@webatlas.test'; // feature.* + submission.review on 48
const X = 'juris-ward@webatlas.test'; // the same on ward 20194
const E = 'juris-noreview@webatlas.test'; // feature.update on 48, no review right
const A = 'juris-admin@webatlas.test'; // admin, no groups
const GROUP_PREFIX = 'juris-test-';
const NAME = 'juris-dam@webatlas.test';

// Two real wards of province 48 (Đà Nẵng), and another province (Quảng Ngãi).
const WARD_A = '20194';
const WARD_B = '20200';
const OTHER_PROVINCE = '51';
const FULL = ['feature.create', 'feature.update', 'feature.delete', 'submission.review'];

type Point = { type: 'Point'; coordinates: [number, number] };
// A guaranteed interior point of each unit, from ST_PointOnSurface.
const inside = new Map<string, Point>();
const unitName = new Map<string, string>();
const ids = new Map<string, string>();

// One login per user for the whole file: /api/auth/login allows 10 per minute.
const tokens = new Map<string, string>();
async function tokenFor(email: string) {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PW } });
  const token = res.json().token as string;
  tokens.set(email, token);
  return token;
}
const auth = async (email: string) => ({ authorization: `Bearer ${await tokenFor(email)}` });

async function createGroup(name: string, units: string[], permissions: string[], members: string[]) {
  const pg = getPool();
  const { rows } = await pg.query(`INSERT INTO app.access_groups (name) VALUES ($1) RETURNING id`, [GROUP_PREFIX + name]);
  const groupId = rows[0].id as string;
  for (const u of units) await pg.query(`INSERT INTO app.access_group_units (group_id, unit_code) VALUES ($1, $2)`, [groupId, u]);
  for (const p of permissions) {
    await pg.query(`INSERT INTO app.access_group_permissions (group_id, permission) VALUES ($1, $2)`, [groupId, p]);
  }
  for (const m of members) await pg.query(`INSERT INTO app.user_groups (user_id, group_id) VALUES ($1, $2)`, [ids.get(m), groupId]);
}

async function cleanupPrincipals() {
  await getPool().query(`DELETE FROM app.access_groups WHERE name LIKE $1`, [GROUP_PREFIX + '%']);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'juris-%@webatlas.test'`);
}

/** Admin creates a dam at `point` managed by `unit`; returns its row id. */
async function damAt(point: Point, unit: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/layers/dams/features', headers: await auth(A),
    payload: { geometry: point, properties: { name: NAME, managing_unit: unit } },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().feature.properties.managing_unit).toBe(unit);
  return res.json().feature.id as string;
}

async function put(email: string, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'PUT', url: `/api/layers/dams/features/${id}`, headers: await auth(email), payload });
}

async function activeUnit(id: string): Promise<string | null> {
  const { rows } = await getPool().query(`SELECT managing_unit FROM water.dams_active WHERE id = $1`, [id]);
  return rows[0]?.managing_unit ?? null;
}

beforeAll(async () => {
  await app.ready();
  await cleanupPrincipals();
  const repo = usersRepository(getPool());
  for (const [email, role] of [[P, 'viewer'], [X, 'viewer'], [E, 'viewer'], [A, 'admin']] as const) {
    const row = await repo.insert({ email, password_hash: await hashPassword(PW), full_name: email, role });
    ids.set(email, row.id);
  }
  await createGroup('province', ['48'], FULL, [P]);
  await createGroup('ward', [WARD_A], FULL, [X]);
  await createGroup('noreview', ['48'], ['feature.update'], [E]);

  const { rows } = await getPool().query<{ code: string; x: number; y: number }>(
    `SELECT code, ST_X(p) AS x, ST_Y(p) AS y FROM (
       SELECT code, ST_PointOnSurface(geom) AS p FROM admin.wards WHERE code = ANY($1)
       UNION ALL
       SELECT code, ST_PointOnSurface(geom) FROM admin.provinces WHERE code = $2) s`,
    [[WARD_A, WARD_B], OTHER_PROVINCE]
  );
  for (const r of rows) inside.set(r.code, { type: 'Point', coordinates: [r.x, r.y] });
  expect(inside.size).toBe(3);
  const names = await getPool().query<{ code: string; name: string }>(
    `SELECT code, name FROM admin.unit_tree WHERE code = ANY($1)`, [['48', OTHER_PROVINCE, WARD_A, WARD_B]]
  );
  for (const r of names.rows) unitName.set(r.code, r.name);
});

afterAll(async () => {
  // Every write publishes an edit-version on `dams`: drop them and restore the seeded
  // ingest version as active, as layers.test.ts does.
  await getPool().query(
    `DELETE FROM water.dams WHERE dataset_version_id IN
       (SELECT id FROM app.dataset_versions WHERE layer_key = 'dams' AND kind = 'edit')`
  );
  await getPool().query(`DELETE FROM app.dataset_versions WHERE layer_key = 'dams' AND kind = 'edit'`);
  const restored = await getPool().query(
    `UPDATE app.dataset_versions SET is_active = true
     WHERE id = (SELECT id FROM app.dataset_versions
                 WHERE layer_key = 'dams' AND kind = 'ingest'
                 ORDER BY ingested_at DESC LIMIT 1)
     RETURNING id`
  );
  if (restored.rows[0]) {
    const client = await getPool().connect();
    try {
      await refreshCurrentRows(client, 'dams', restored.rows[0].id);
    } finally {
      client.release();
    }
  }
  await getPool().query('DELETE FROM water.dams WHERE name = $1', [NAME]);
  await cleanupPrincipals();
  await app.close();
});

describe('feature updates check the managing unit', () => {
  it('a province officer edits a ward feature inside the province', async () => {
    const id = await damAt(inside.get(WARD_A)!, WARD_A);
    const res = await put(P, id, { properties: { status: 'operational' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().feature.properties.status).toBe('operational');
    expect(res.json().warnings).toEqual([]);
  });

  it('is refused in another province', async () => {
    const id = await damAt(inside.get(OTHER_PROVINCE)!, OTHER_PROVINCE);
    const res = await put(P, id, { properties: { status: 'operational' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({
      code: 'OUT_OF_JURISDICTION',
      message: `Đối tượng thuộc ${unitName.get(OTHER_PROVINCE)}; nhóm của anh/chị chỉ có quyền trong ${unitName.get('48')}.`,
      details: { unit: OTHER_PROVINCE, permission: 'feature.update', allowed: ['48'] },
    });
  });

  it("a ward officer cannot edit the province's feature", async () => {
    const id = await damAt(inside.get(WARD_A)!, '48');
    const res = await put(X, id, { properties: { status: 'operational' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('OUT_OF_JURISDICTION');
  });

  it('moving a managing unit out of jurisdiction is refused', async () => {
    const id = await damAt(inside.get(WARD_A)!, WARD_A);
    const refused = await put(X, id, { properties: { managing_unit: '48' } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('OUT_OF_JURISDICTION');
    expect(refused.json().error.details.unit).toBe('48');
    expect(await activeUnit(id)).toBe(WARD_A);

    const moved = await put(P, id, { properties: { managing_unit: WARD_B } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().feature.properties.managing_unit).toBe(WARD_B);
    expect(await activeUnit(moved.json().feature.id)).toBe(WARD_B);
  });

  it("refuses when the current row's managing unit moved out of jurisdiction", async () => {
    const r1 = await damAt(inside.get(WARD_A)!, WARD_A);
    const moved = await put(P, r1, { properties: { managing_unit: WARD_B } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().feature.id).not.toBe(r1);
    // X still holds r1, which was in its ward when loaded.
    const res = await put(X, r1, { properties: { status: 'operational' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('OUT_OF_JURISDICTION');
    expect(res.json().error.details.unit).toBe(WARD_B);
  });

  it('edit without review right is refused until P4', async () => {
    const id = await damAt(inside.get(WARD_A)!, '48');
    const res = await put(E, id, { properties: { status: 'operational' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({
      code: 'NO_PERMISSION',
      message: 'Anh/chị chưa có quyền duyệt và xuất bản ở đơn vị nào.',
    });
  });

  it('admin edits anywhere', async () => {
    const id = await damAt(inside.get(OTHER_PROVINCE)!, OTHER_PROVINCE);
    const res = await put(A, id, { properties: { status: 'operational', managing_unit: 'VN' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().feature.properties.managing_unit).toBe('VN');
  });

  it('refuses a malformed or unknown managing unit', async () => {
    const id = await damAt(inside.get(WARD_A)!, WARD_A);
    const malformed = await put(A, id, { properties: { managing_unit: '123' } });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.details.fieldErrors.managing_unit).toEqual(['Mã đơn vị không hợp lệ']);
    const unknown = await put(A, id, { properties: { managing_unit: '99' } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.details.fieldErrors.managing_unit).toEqual(['Mã đơn vị không hợp lệ']);
  });

  it('moving a dam out of its managing unit warns and keeps the unit', async () => {
    const id = await damAt(inside.get(WARD_A)!, WARD_A);
    const res = await put(P, id, { geometry: inside.get(WARD_B) });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toEqual([{
      code: 'OUTSIDE_MANAGING_UNIT',
      message: `Đối tượng không còn nằm trong ${unitName.get(WARD_A)}. Kiểm tra lại đơn vị chủ quản.`,
    }]);
    expect(res.json().feature.properties.managing_unit).toBe(WARD_A);
    expect(await activeUnit(res.json().feature.id)).toBe(WARD_A);
  });

  it('never warns for a feature managed by VN', async () => {
    const id = await damAt(inside.get(WARD_A)!, 'VN');
    const res = await put(A, id, { geometry: inside.get(OTHER_PROVINCE) });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toEqual([]);
  });
});

describe('feature creation checks the managing unit', () => {
  it('create without geometry and without managing_unit asks for a unit', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: await auth(P),
      payload: { properties: { name: NAME } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.fieldErrors.managing_unit).toEqual(['Chọn đơn vị chủ quản']);
  });

  it('admin cannot create an empty feature either', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/layers/dams/features', headers: await auth(A), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.fieldErrors.managing_unit).toEqual(['Chọn đơn vị chủ quản']);
  });

  it('create suggests the containing ward', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: await auth(P),
      payload: { geometry: inside.get(WARD_A), properties: { name: NAME } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().feature.properties.managing_unit).toBe(WARD_A);
    expect(res.json().warnings).toEqual([]);
    expect(await activeUnit(res.json().feature.id)).toBe(WARD_A);
  });

  it('create without geometry accepts an explicit unit in jurisdiction', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: await auth(X),
      payload: { properties: { name: NAME, managing_unit: WARD_A } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().feature.geometry).toBeNull();
    expect(await activeUnit(res.json().feature.id)).toBe(WARD_A);
  });

  it('refuses a create whose unit, given or suggested, is out of jurisdiction', async () => {
    const given = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: await auth(X),
      payload: { geometry: inside.get(WARD_A), properties: { name: NAME, managing_unit: '48' } },
    });
    expect(given.statusCode).toBe(403);
    expect(given.json().error.details).toEqual({ unit: '48', permission: 'feature.create', allowed: [WARD_A] });

    const suggested = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: await auth(X),
      payload: { geometry: inside.get(WARD_B), properties: { name: NAME } },
    });
    expect(suggested.statusCode).toBe(403);
    expect(suggested.json().error.details.unit).toBe(WARD_B);
  });

  it('a create with a unit the geometry lies outside of warns', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: await auth(P),
      payload: { geometry: inside.get(WARD_B), properties: { name: NAME, managing_unit: WARD_A } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().warnings.map((w: { code: string }) => w.code)).toEqual(['OUTSIDE_MANAGING_UNIT']);
    expect(res.json().feature.properties.managing_unit).toBe(WARD_A);
  });

  it('a user holding no create right is refused at the route', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: await auth(E),
      payload: { geometry: inside.get(WARD_A), properties: { name: NAME } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NO_PERMISSION');
    expect(res.json().error.message).toBe('Anh/chị chưa có quyền thêm đối tượng ở đơn vị nào.');
  });
});

describe('feature deletion checks the managing unit', () => {
  it('deletes inside jurisdiction and refuses outside it', async () => {
    const own = await damAt(inside.get(WARD_A)!, WARD_A);
    const theirs = await damAt(inside.get(WARD_A)!, '48');

    const refused = await app.inject({ method: 'DELETE', url: `/api/layers/dams/features/${theirs}`, headers: await auth(X) });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toEqual({ unit: '48', permission: 'feature.delete', allowed: [WARD_A] });
    expect(await activeUnit(theirs)).toBe('48');

    const done = await app.inject({ method: 'DELETE', url: `/api/layers/dams/features/${own}`, headers: await auth(X) });
    expect(done.statusCode).toBe(204);
    expect(await activeUnit(own)).toBeNull();
  });

  it('a user holding no delete right is refused at the route', async () => {
    const id = await damAt(inside.get(WARD_A)!, '48');
    const res = await app.inject({ method: 'DELETE', url: `/api/layers/dams/features/${id}`, headers: await auth(E) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NO_PERMISSION');
  });
});

describe('admin units for the managing-unit picker', () => {
  it('the suggest endpoint applies the rule', async () => {
    const ward = await app.inject({ method: 'POST', url: '/api/admin-units/suggest', payload: { geometry: inside.get(WARD_A) } });
    expect(ward.statusCode).toBe(200);
    expect(ward.json()).toEqual({ unit: WARD_A });

    // Spanning two provinces -> VN.
    const across = await app.inject({
      method: 'POST', url: '/api/admin-units/suggest',
      payload: { geometry: { type: 'LineString', coordinates: [inside.get(WARD_A)!.coordinates, inside.get(OTHER_PROVINCE)!.coordinates] } },
    });
    expect(across.statusCode).toBe(200);
    expect(across.json()).toEqual({ unit: 'VN' });
  });

  it('the suggest endpoint refuses something that is not a geometry', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/admin-units/suggest', payload: {} });
    expect(missing.statusCode).toBe(400);
    const junk = await app.inject({ method: 'POST', url: '/api/admin-units/suggest', payload: { geometry: { type: 'Circle' } } });
    expect(junk.statusCode).toBe(422);
    const unparsable = await app.inject({
      method: 'POST', url: '/api/admin-units/suggest', payload: { geometry: { type: 'Point', coordinates: 'x' } },
    });
    expect(unparsable.statusCode).toBe(422);
  });

  it('serves the unit tree without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin-units/tree' });
    expect(res.statusCode).toBe(200);
    const units = res.json().units as Array<{ code: string; level: string; parent: string | null; name: string }>;
    expect(units).toContainEqual({ code: 'VN', level: 'country', parent: null, name: 'Toàn quốc' });
    expect(units).toContainEqual({ code: WARD_A, level: 'ward', parent: '48', name: unitName.get(WARD_A) });
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM admin.unit_tree`);
    expect(units).toHaveLength(rows[0].n);
  });
});
