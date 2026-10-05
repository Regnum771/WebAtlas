import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { refreshCurrentRows } from '@webatlas/versioning';

const app = buildApp();
const ADMIN = 'layers-admin@webatlas.test';
const EDITOR = 'layers-editor@webatlas.test';
const VIEWER = 'layers-viewer@webatlas.test';
const PW = 'admin-pass-123';
const NAME = 'layers-crud-dam@webatlas.test';

// One login per user for the whole file: /api/auth/login allows 10 per minute, and a
// fresh login per test hits that ceiling (the eleventh answers 401).
const tokens = new Map<string, string>();
async function tokenFor(email: string) {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PW } });
  const token = res.json().token as string;
  tokens.set(email, token);
  return token;
}

beforeAll(async () => {
  await app.ready();
  const repo = usersRepository(getPool());
  for (const [email, role] of [[ADMIN, 'admin'], [EDITOR, 'editor'], [VIEWER, 'viewer']] as const) {
    if (!(await repo.findByEmailWithHash(email))) {
      await repo.insert({ email, password_hash: await hashPassword(PW), full_name: role, role });
    }
  }
});
afterAll(async () => {
  // Every POST/PUT/DELETE above publishes an edit-version on `dams`, so this suite must
  // drop the edit-versions it created and restore the seeded ingest version as active.
  // Without this the suite depends on another file's afterAll sweeping up after it and
  // leaves a permanently-active orphan edit-version when run in isolation.
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
  // Raw flip instead of activate(): move the current flag with it.
  if (restored.rows[0]) {
    const client = await getPool().connect();
    try {
      await refreshCurrentRows(client, 'dams', restored.rows[0].id);
    } finally {
      client.release();
    }
  }
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
    expect(keys).toHaveLength(8);
  });
});

describe('feature CRUD (admin only)', () => {
  it('viewer can read features but cannot write; anonymous is 401', async () => {
    const viewerToken = await tokenFor(VIEWER);
    const vAuth = { authorization: `Bearer ${viewerToken}` };

    const read = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: vAuth });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: vAuth,
      payload: { geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { name: NAME } },
    });
    expect(write.statusCode).toBe(403);

    const anon = await app.inject({ method: 'GET', url: '/api/layers/dams/features' });
    expect(anon.statusCode).toBe(401);
  });

  it('editor can read features but cannot write (read-only since 2026-09-17)', async () => {
    const editorToken = await tokenFor(EDITOR);
    const eAuth = { authorization: `Bearer ${editorToken}` };

    const read = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: eAuth });
    expect(read.statusCode).toBe(200);

    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: eAuth,
      payload: { geometry: { type: 'Point', coordinates: [105.81, 21.01] }, properties: { name: NAME } },
    });
    expect(create.statusCode).toBe(403);
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

  it('admin update stores the source document and provider on the audit row', async () => {
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };
    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: auth,
      payload: { geometry: { type: 'Point', coordinates: [108.99, 12.93] }, properties: { name: NAME } },
    });
    const id = create.json().feature.id;

    const upd = await app.inject({
      method: 'PUT', url: `/api/layers/dams/features/${id}`, headers: auth,
      payload: {
        properties: { wattage_mw: 72 },
        source: { document: 'Quyết định 123/QĐ-UBND', provider: 'Sở Công Thương Đắk Lắk' },
      },
    });
    expect(upd.statusCode).toBe(200);

    const { rows } = await getPool().query(
      `SELECT source_document, source_provider FROM app.audit_log
        WHERE feature_id = $1 AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [id]
    );
    expect(rows[0]).toEqual({ source_document: 'Quyết định 123/QĐ-UBND', source_provider: 'Sở Công Thương Đắk Lắk' });
  });

  it('an update with properties only keeps the stored geometry exactly', async () => {
    // The web editor sends no geometry on an attribute-only save (its geometry may be a
    // simplified copy), so the copy-on-write row must carry the stored shape over unchanged.
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };
    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: auth,
      payload: { geometry: { type: 'Point', coordinates: [108.123456789, 12.987654321] }, properties: { name: NAME } },
    });
    expect(create.statusCode).toBe(201);
    const before = create.json().feature.id as string;

    const upd = await app.inject({
      method: 'PUT', url: `/api/layers/dams/features/${before}`, headers: auth,
      payload: { properties: { name: NAME, wattage_mw: 12 } },
    });
    expect(upd.statusCode).toBe(200);
    const after = upd.json().feature.id as string;

    const { rows } = await getPool().query<{ same: boolean; has_geom: boolean }>(
      `SELECT ST_Equals(a.geom, b.geom) AS same, b.geom IS NOT NULL AS has_geom
         FROM water.dams a, water.dams b WHERE a.id = $1 AND b.id = $2`,
      [before, after]
    );
    expect(rows[0]).toEqual({ same: true, has_geom: true });
  });

  it('rejects a blank source provider', async () => {
    const token = await tokenFor(ADMIN);
    const res = await app.inject({
      method: 'PUT', url: '/api/layers/dams/features/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token}` },
      payload: { properties: { name: 'x' }, source: { document: 'QĐ 1', provider: '' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('stamps administrative codes when the edit session commits, and re-stamps on a move', async () => {
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };

    // Buôn Ma Thuột — Đắk Lắk, province code 66.
    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: auth,
      payload: { geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { name: NAME } },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().feature.id;

    const stamped = await getPool().query<{ province_codes: string[] }>(
      `SELECT province_codes FROM water.dams_active WHERE id = $1`, [id]
    );
    expect(stamped.rows[0].province_codes).toEqual(['66']);

    // Move it into Lâm Đồng (province code 68): Đà Lạt, 108.44 / 11.94.
    const moved = await app.inject({
      method: 'PUT', url: `/api/layers/dams/features/${id}`, headers: auth,
      payload: { geometry: { type: 'Point', coordinates: [108.44, 11.94] } },
    });
    expect(moved.statusCode).toBe(200);

    const restamped = await getPool().query<{ province_codes: string[] }>(
      `SELECT province_codes FROM water.dams_active WHERE id = $1`, [moved.json().feature.id]
    );
    expect(restamped.rows[0].province_codes).toEqual(['68']);
  });
});

describe('feature listing', () => {
  it('returns one row per feature, not one per version', async () => {
    const token = await tokenFor(ADMIN);
    const res = await app.inject({
      method: 'GET', url: '/api/layers/dams/features',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().features.map((f: { id: string }) => f.id);
    expect(new Set(ids).size).toBe(ids.length);

    const active = await getPool().query<{ n: string }>(`SELECT count(*)::text AS n FROM water.dams_active`);
    expect(ids).toHaveLength(Number(active.rows[0].n));
  });

  it('filters by province and by ward', async () => {
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };

    const all = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: auth });
    const inDakLak = await app.inject({ method: 'GET', url: '/api/layers/dams/features?province=66', headers: auth });
    expect(inDakLak.statusCode).toBe(200);

    const total = all.json().features.length;
    const subset = inDakLak.json().features.length;
    expect(subset).toBeGreaterThan(0);
    expect(subset).toBeLessThan(total);

    const { rows } = await getPool().query<{ code: string }>(
      `SELECT ward_codes[1] AS code FROM water.dams_active
        WHERE array_length(ward_codes, 1) IS NOT NULL LIMIT 1`
    );
    const byWard = await app.inject({
      method: 'GET', url: `/api/layers/dams/features?ward=${rows[0].code}`, headers: auth,
    });
    expect(byWard.json().features.length).toBeGreaterThan(0);
    expect(byWard.json().features.length).toBeLessThanOrEqual(subset);
  });

  it('rejects a malformed unit code rather than ignoring it', async () => {
    const token = await tokenFor(ADMIN);
    const res = await app.inject({
      method: 'GET', url: '/api/layers/dams/features?province=' + 'x'.repeat(20),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
