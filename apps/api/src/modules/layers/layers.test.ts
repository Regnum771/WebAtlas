import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { discardDraft, openDraft, versionsService } from '@webatlas/versioning';
import { pinLayer, restoreActive, runStages, unpinLayer } from '@webatlas/versioning/testing';

const app = buildApp();
const ADMIN = 'layers-admin@webatlas.test';
// The former editor: a viewer with no groups, so it holds no write permission anywhere.
// Jurisdiction cases (groups, managing units) live in jurisdiction.test.ts.
const NO_GROUPS = 'layers-nogroups@webatlas.test';
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
  for (const [email, role] of [[ADMIN, 'admin'], [NO_GROUPS, 'viewer'], [VIEWER, 'viewer']] as const) {
    if (!(await repo.findByEmailWithHash(email))) {
      await repo.insert({ email, password_hash: await hashPassword(PW), full_name: role, role });
    }
  }
});
const PIN = 'layers.test';
let since: Date;
let priorActive: string | null = null;

/**
 * Drop the edit versions this suite's direct writes published, and nothing else. They are the
 * dams versions of kind 'edit' that are not drafts, come from an edit session and were ingested
 * since the suite started; test files run one at a time. Open drafts (and the drafts behind
 * workspace edit-copy layers) belong to other people and are left alone.
 * The caller must have restored the active version first: deleting the active one leaves the layer with none.
 */
async function dropOwnEdits(from: Date): Promise<void> {
  const own = `SELECT id FROM app.dataset_versions
                WHERE layer_key = 'dams' AND kind = 'edit' AND draft_status IS NULL
                  AND source = 'edit session' AND ingested_at >= $1`;
  await getPool().query(`DELETE FROM water.dams WHERE dataset_version_id IN (${own})`, [from]);
  await getPool().query(`DELETE FROM app.dataset_versions WHERE id IN (${own})`, [from]);
}

beforeAll(async () => {
  await app.ready();
  const pool = getPool();
  const repo = usersRepository(pool);
  for (const [email, role] of [[ADMIN, 'admin'], [NO_GROUPS, 'viewer'], [VIEWER, 'viewer']] as const) {
    if (!(await repo.findByEmailWithHash(email))) {
      await repo.insert({ email, password_hash: await hashPassword(PW), full_name: role, role });
    }
  }
  // Every direct write below activates a version of dams: pin the existing ones so retention
  // cannot prune a real ingest while this file runs.
  await pinLayer(pool, 'dams', PIN);
  priorActive = await versionsService(pool).getActiveVersionId('dams');
  since = (await pool.query<{ t: Date }>(`SELECT clock_timestamp() AS t`)).rows[0].t;
});
afterAll(async () => {
  const pool = getPool();
  // Until the prior version is active again, one of ours is the active version of dams:
  // deleting our versions then would leave the layer with none.
  let restored = priorActive === null;
  await runStages([
    async () => {
      if (!priorActive) return;
      await restoreActive(pool, 'dams', priorActive);
      restored = true;
    },
    async () => { if (restored) await dropOwnEdits(since); },
    () => unpinLayer(pool, PIN),
    () => pool.query('DELETE FROM water.dams WHERE name = $1', [NAME]),
    () => pool.query(`DELETE FROM app.users WHERE email LIKE 'layers-%@webatlas.test'`),
    () => app.close(),
  ]);
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

describe('feature CRUD', () => {
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
    expect(write.json().error.code).toBe('NO_PERMISSION');

    const anon = await app.inject({ method: 'GET', url: '/api/layers/dams/features' });
    expect(anon.statusCode).toBe(401);
  });

  it('a viewer without groups can read features but cannot write', async () => {
    const noGroupsToken = await tokenFor(NO_GROUPS);
    const eAuth = { authorization: `Bearer ${noGroupsToken}` };

    const read = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: eAuth });
    expect(read.statusCode).toBe(200);

    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: eAuth,
      payload: { geometry: { type: 'Point', coordinates: [105.81, 21.01] }, properties: { name: NAME } },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().error).toEqual({
      code: 'NO_PERMISSION',
      message: 'Anh/chị chưa có quyền thêm đối tượng ở đơn vị nào.',
    });

    const someDam = (await getPool().query(`SELECT id FROM water.dams_active LIMIT 1`)).rows[0].id as string;
    const update = await app.inject({
      method: 'PUT', url: `/api/layers/dams/features/${someDam}`, headers: eAuth,
      payload: { properties: { name: NAME } },
    });
    expect(update.statusCode).toBe(403);
    expect(update.json().error.code).toBe('NO_PERMISSION');
    const del = await app.inject({ method: 'DELETE', url: `/api/layers/dams/features/${someDam}`, headers: eAuth });
    expect(del.statusCode).toBe(403);
    expect(del.json().error.code).toBe('NO_PERMISSION');
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

describe('test cleanup', () => {
  it("cleanup leaves other people's drafts alone", async () => {
    const pool = getPool();
    const viewer = await usersRepository(pool).findByEmailWithHash(VIEWER);
    const testStart = (await pool.query<{ t: Date }>(`SELECT clock_timestamp() AS t`)).rows[0].t;
    const before = await versionsService(pool).getActiveVersionId('dams');
    let draftId: string | null = null;
    let restored = false;
    await runStages([
      async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          draftId = (await openDraft(c, 'dams', viewer!.id)).id;
          await c.query('COMMIT');
        } finally {
          await c.query('ROLLBACK').catch(() => {});
          c.release();
        }
      },
      async () => {
        const auth = { authorization: `Bearer ${await tokenFor(ADMIN)}` };
        const res = await app.inject({
          method: 'POST', url: '/api/layers/dams/features', headers: auth,
          payload: { geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { name: NAME } },
        });
        expect(res.statusCode).toBe(201);
      },
      async () => {
        await restoreActive(pool, 'dams', before!);
        restored = true;
        await dropOwnEdits(testStart);
        const edits = await pool.query(
          `SELECT 1 FROM app.dataset_versions
            WHERE layer_key = 'dams' AND kind = 'edit' AND draft_status IS NULL
              AND source = 'edit session' AND ingested_at >= $1`, [testStart]
        );
        expect(edits.rowCount).toBe(0);
        const draft = await pool.query(`SELECT 1 FROM app.dataset_versions WHERE id = $1`, [draftId]);
        expect(draft.rowCount).toBe(1);
      },
      async () => {
        if (!draftId) return;
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await discardDraft(c, draftId);
          await c.query('COMMIT');
        } finally {
          await c.query('ROLLBACK').catch(() => {});
          c.release();
        }
      },
    ]);
    expect(restored).toBe(true);
  });
});
