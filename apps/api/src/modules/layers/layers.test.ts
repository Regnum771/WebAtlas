import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const ADMIN = 'layers-admin@webatlas.test';
const EDITOR = 'layers-editor@webatlas.test';
const PW = 'admin-pass-123';
const NAME = 'layers-crud-dam@webatlas.test';

async function tokenFor(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PW } });
  return res.json().token as string;
}

beforeAll(async () => {
  await app.ready();
  const repo = usersRepository(getPool());
  for (const [email, role] of [[ADMIN, 'admin'], [EDITOR, 'editor']] as const) {
    if (!(await repo.findByEmailWithHash(email))) {
      await repo.insert({ email, password_hash: await hashPassword(PW), full_name: role, role });
    }
  }
});
afterAll(async () => {
  await getPool().query('DELETE FROM water.dams WHERE name = $1', [NAME]);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'layers-%@webatlas.test'`);
  await app.close();
});

describe('layers metadata', () => {
  it('GET /api/layers returns the derived catalog (no auth)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/layers' });
    expect(res.statusCode).toBe(200);
    const keys = res.json().layers.map((l: { key: string }) => l.key);
    expect(keys).toContain('dams');
    expect(keys).toHaveLength(7);
  });
});

describe('feature CRUD (admin only)', () => {
  it('rejects non-admin with 403 and anonymous with 401', async () => {
    const editorToken = await tokenFor(EDITOR);
    const forbidden = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: { authorization: `Bearer ${editorToken}` } });
    expect(forbidden.statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: '/api/layers/dams/features' });
    expect(anon.statusCode).toBe(401);
  });

  it('404 for an unknown layer key', async () => {
    const token = await tokenFor(ADMIN);
    const res = await app.inject({ method: 'GET', url: '/api/layers/not_a_layer/features', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('admin creates, reads (GeoJSON), updates, deletes; audit rows written', async () => {
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };

    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: auth,
      payload: { geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { name: NAME, status: 'operational' } },
    });
    expect(create.statusCode).toBe(201);
    const feature = create.json().feature;
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('Point');
    expect(feature.properties.name).toBe(NAME);
    const id = feature.id;

    const list = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: auth });
    expect(list.json().type).toBe('FeatureCollection');
    expect(list.json().features.some((f: { id: string }) => f.id === id)).toBe(true);

    const upd = await app.inject({
      method: 'PUT', url: `/api/layers/dams/features/${id}`, headers: auth,
      payload: { properties: { status: 'decommissioned' } },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().feature.properties.status).toBe('decommissioned');

    const bad = await app.inject({
      method: 'PUT', url: `/api/layers/dams/features/${id}`, headers: auth,
      payload: { geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    });
    expect(bad.statusCode).toBe(422);

    const del = await app.inject({ method: 'DELETE', url: `/api/layers/dams/features/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);

    const audit = await getPool().query(
      `SELECT action FROM app.audit_log WHERE table_name = 'water.dams' AND feature_id = $1 ORDER BY created_at`,
      [id]
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['create', 'update', 'delete']);
  });
});
