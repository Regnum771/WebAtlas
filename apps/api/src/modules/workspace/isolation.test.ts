import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { discardDraft, versionsService } from '@webatlas/versioning';
import { pinLayer, restoreActive, runStages, unpinLayer } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

// Isolation, proven: strangers learn nothing from any workspace route, the assistant DB role
// cannot read the workspace schema (the GeoServer guard is tested in @webatlas/atlas-data).

const app = buildApp();
// Collect every route the app registers; the hook must be added before the plugins load.
const registered = new Set<string>();
app.addHook('onRoute', (r) => {
  for (const m of Array.isArray(r.method) ? r.method : [r.method]) {
    if (m !== 'HEAD' && r.url.startsWith('/api/workspace')) registered.add(`${m} ${r.url}`);
  }
});

const LAYER = 'dams';
const SOURCE = 'isolation.test';
const PIN = 'isolation.test';
const PW = 'p3a-isolation-pass-123';
const email = (who: string) => `p3a-isolation-${who}@webatlas.test`;
const O = email('owner');
const S = email('stranger');
const R = email('recipient'); // holds the map's one share, so the share id is real
const A = email('admin'); // admin rights grant no read access to someone else's map
const ids = new Map<string, string>();

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Không tìm thấy bản đồ.' } };

// Synthetic dams for this file, all managed by 48, one every 0.01° along a line in Đà Nẵng.
const DAMS = Array.from({ length: 10 }, (_, i) => 901021 + i);
const xOf = (ext: number) => 108 + (ext - 901000) * 0.01;
const Y = 16.05;
const ALL = `${xOf(DAMS[0]) - 0.005},${Y - 0.01},${xOf(DAMS[9]) + 0.005},${Y + 0.01}`;

const created: string[] = [];
let priorActive: string | null = null;

// Each user calls from an address of its own, as separate clients would: the rate limit is 100
// requests a minute per address, and the sweep alone sends more than that in all.
const ADDRESS: Record<string, string> = { [O]: '10.0.0.1', [S]: '10.0.0.2', [R]: '10.0.0.3', [A]: '10.0.0.4' };

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

async function cleanupPrincipals() {
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3a-isolation-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  const pool = getPool();
  await cleanupPrincipals();
  const repo = usersRepository(pool);
  for (const [who, role] of [[O, 'viewer'], [S, 'viewer'], [R, 'viewer'], [A, 'admin']] as const) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role });
    ids.set(who, row.id);
  }
  priorActive = await versionsService(pool).getActiveVersionId(LAYER);
  // This file commits an activation on dams: pin every existing version so retention cannot
  // prune a real ingest while it runs.
  await pinLayer(pool, LAYER, PIN);
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ($1, 'ingest', $2, 'isolation-test root', false) RETURNING id`,
      [LAYER, SOURCE]
    );
    created.push(rows[0].id);
    for (const ext of DAMS) {
      await c.query(
        `INSERT INTO water.dams
           (external_id, name, geom, dataset_version_id, province_codes, ward_codes, managing_unit, deleted)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, '{}', '{}', '48', false)`,
        [ext, `dam-${ext}`, xOf(ext), Y, rows[0].id]
      );
    }
    await versionsService(pool).activate(c, LAYER, rows[0].id);
  });
});

afterAll(async () => {
  const pool = getPool();
  const userIds = [...ids.values()];
  let restored = priorActive === null;
  let drafts: string[] = [];
  await runStages([
    async () => {
      if (!priorActive) return;
      await restoreActive(pool, LAYER, priorActive);
      restored = true;
    },
    () => unpinLayer(pool, PIN),
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
    async () => {
      if (restored) await pool.query(`DELETE FROM water.dams WHERE dataset_version_id = ANY($1::uuid[])`, [created]);
    },
    async () => {
      if (!restored) return;
      for (const id of [...created].reverse()) await pool.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [id]);
    },
    // audit_log.user_id is ON DELETE SET NULL: delete the audit rows before their users.
    () => pool.query(`DELETE FROM app.audit_log WHERE user_id = ANY($1::uuid[])`, [userIds]),
    cleanupPrincipals,
    () => app.close(),
  ]);
});

type Ctx = { m: string; l: string; f: string; s: string; rev: number };
type Case = { method: Method; pattern: string; query?: string; body?: (c: Ctx) => Record<string, unknown> };

// Every map-scoped route, with a body that passes validation so a 404 can only come from access.
// The test below fails if a route is registered that this table does not list.
const MAP_ROUTES: Case[] = [
  { method: 'GET', pattern: '/maps/:mapId' },
  { method: 'PATCH', pattern: '/maps/:mapId', body: (c) => ({ title: 'Đổi tên', expectedRevision: c.rev }) },
  { method: 'DELETE', pattern: '/maps/:mapId', body: (c) => ({ expectedRevision: c.rev }) },
  { method: 'POST', pattern: '/maps/:mapId/copy' },
  { method: 'GET', pattern: '/maps/:mapId/shares' },
  { method: 'POST', pattern: '/maps/:mapId/shares', body: (c) => ({ userId: c.s }) },
  { method: 'DELETE', pattern: '/maps/:mapId/shares/:shareId' },
  { method: 'POST', pattern: '/maps/:mapId/layers', body: (c) => ({
    kind: 'free', title: 'Lớp mới', geometryType: 'point', fields: [], expectedRevision: c.rev,
  }) },
  { method: 'PATCH', pattern: '/maps/:mapId/layers/:layerId', body: (c) => ({ title: 'Đổi tên lớp', expectedRevision: c.rev }) },
  { method: 'DELETE', pattern: '/maps/:mapId/layers/:layerId', body: (c) => ({ expectedRevision: c.rev }) },
  { method: 'GET', pattern: '/maps/:mapId/layers/:layerId/features' },
  // The map's 404 comes before the layer's kind is read, so a free or edit-copy layer id proves it too.
  { method: 'GET', pattern: '/maps/:mapId/layers/:layerId/raster' },
  { method: 'POST', pattern: '/maps/:mapId/layers/:layerId/features', body: (c) => ({
    geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: {}, expectedRevision: c.rev,
  }) },
  { method: 'PUT', pattern: '/maps/:mapId/layers/:layerId/features/:featureId', body: (c) => ({ properties: {}, expectedRevision: c.rev }) },
  { method: 'DELETE', pattern: '/maps/:mapId/layers/:layerId/features/:featureId', body: (c) => ({ expectedRevision: c.rev }) },
  // A random file id: the map's 404 comes before the upload is looked up.
  { method: 'POST', pattern: '/maps/:mapId/imports', body: () => ({ fileId: randomUUID() }) },
  { method: 'POST', pattern: '/maps/:mapId/exports', body: () => ({ format: 'gpkg', crs: 'wgs84-dd' }) },
  { method: 'GET', pattern: '/maps/:mapId/exports/preview', query: 'format=shp&crs=wgs84-dd' },
];
// The layer routes a raster layer answers (the others refuse its kind after the map's check);
// the sweep also runs them with a raster layer id.
const RASTER_ROUTES = new Set([
  'PATCH /maps/:mapId/layers/:layerId', 'DELETE /maps/:mapId/layers/:layerId', 'GET /maps/:mapId/layers/:layerId/raster',
]);
// Routes that are not map-scoped; each has its own check below.
const OTHER_ROUTES = ['GET /api/workspace/maps', 'POST /api/workspace/maps', 'GET /api/workspace/share-targets', 'GET /api/workspace/admin/summary'];

type OwnerCase = { method: Method; pattern: string; notFound: string };
// Owner-scoped, not map-scoped: an upload or a job belongs to its owner alone. Each is swept with
// a real id of the owner's, and must answer as for an id that does not exist.
const OWNER_ROUTES: OwnerCase[] = [
  { method: 'GET', pattern: '/uploads/:fileId', notFound: 'Không tìm thấy tệp.' },
  { method: 'DELETE', pattern: '/uploads/:fileId', notFound: 'Không tìm thấy tệp.' },
  { method: 'GET', pattern: '/jobs/:jobId', notFound: 'Không tìm thấy công việc.' },
  { method: 'GET', pattern: '/jobs/:jobId/download', notFound: 'Không tìm thấy công việc.' },
  { method: 'DELETE', pattern: '/jobs/:jobId', notFound: 'Không tìm thấy công việc.' },
];
// Owner-scoped lists: checked below to leave out the owner's ids. POST /uploads stores the
// caller's own file and reads no one else's (uploads.test.ts).
const OWNER_LISTS = ['GET /api/workspace/uploads', 'GET /api/workspace/jobs'];
const OWN_UPLOAD = 'POST /api/workspace/uploads';

function fill(route: Case, c: Ctx, withBbox: boolean): string {
  const url = route.pattern.replace(':mapId', c.m).replace(':layerId', c.l).replace(':featureId', c.f).replace(':shareId', c.s);
  if (route.query) return `${url}?${route.query}`;
  return withBbox && url.endsWith('/features') ? `${url}?bbox=${ALL}` : url;
}

describe('workspace isolation', () => {
  it('every workspace route is covered by this sweep', () => {
    const covered = new Set([
      ...MAP_ROUTES.map((r) => `${r.method} /api/workspace${r.pattern}`),
      ...OTHER_ROUTES,
      ...OWNER_ROUTES.map((r) => `${r.method} /api/workspace${r.pattern}`),
      ...OWNER_LISTS,
      OWN_UPLOAD,
    ]);
    expect([...registered].sort()).toEqual([...covered].sort());
    for (const key of covered) {
      const [method, url] = key.split(' ');
      expect(app.hasRoute({ method: method as Method, url }), key).toBe(true);
    }
  });

  it('every workspace route refuses a stranger with 404', async () => {
    const mapRes = await call(O, 'POST', '/maps', { title: 'Bản đồ riêng tư' });
    const map = mapRes.json().map as { id: string };
    const free = (await call(O, 'POST', `/maps/${map.id}/layers`, {
      kind: 'free', title: 'Điểm', geometryType: 'point', fields: [{ name: 'ten', type: 'text' }], expectedRevision: 0,
    })).json().layer as { id: string };
    const feat = (await call(O, 'POST', `/maps/${map.id}/layers/${free.id}/features`, {
      geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { ten: 'bí mật' }, expectedRevision: 1,
    })).json().feature as { id: string };
    const ec = await call(O, 'POST', `/maps/${map.id}/layers`, { kind: 'edit_copy', layerKey: LAYER, expectedRevision: 2 });
    expect(ec.statusCode).toBe(201);
    const ecLayer = ec.json().layer as { id: string };
    const share = (await call(O, 'POST', `/maps/${map.id}/shares`, { userId: ids.get(R)! })).json().share as { id: string };
    // An edit-copy feature id, from the draft's bbox read.
    const ecFeat = (await call(O, 'GET', `/maps/${map.id}/layers/${ecLayer.id}/features?bbox=${ALL}`)).json().features[0] as { id: string };
    expect(ecFeat).toBeTruthy();
    // A raster layer, as the worker's raster import leaves it: a cog files row and the layer row.
    // The file itself is never read: every request below stops at the map's 404.
    const owner = ids.get(O)!;
    const cogId = randomUUID();
    await getPool().query(
      `INSERT INTO workspace.files (id, owner_id, kind, path, original_name, content_type, size_bytes)
       VALUES ($1, $2, 'cog', $3, 'anh.tif', 'image/tiff', 1)`,
      [cogId, owner, `cog/${owner}/${cogId}.tif`]
    );
    const rasterLayer = (await getPool().query<{ id: string }>(
      `INSERT INTO workspace.map_layers (map_id, kind, title, position, file_id, raster)
       VALUES ($1, 'raster', 'Ảnh', 2, $2, '{}'::jsonb) RETURNING id`,
      [map.id, cogId]
    )).rows[0].id;

    const before = (await call(O, 'GET', `/maps/${map.id}`)).json().map;
    const real = { m: map.id, s: share.id, rev: before.revision };
    const layers: Array<{ name: string; l: string; f: string; only?: Set<string> }> = [
      { name: 'free', l: free.id, f: feat.id },
      { name: 'edit_copy', l: ecLayer.id, f: ecFeat.id },
      { name: 'raster', l: rasterLayer, f: randomUUID(), only: RASTER_ROUTES },
    ];

    let sweeps = 0;
    for (const who of [S, A]) {
      for (const route of MAP_ROUTES) {
        const forRoute = layers.filter((l) => !l.only || l.only.has(`${route.method} ${route.pattern}`));
        for (const layer of route.pattern.includes(':layerId') ? forRoute : [layers[0]]) {
          const label = `${who} ${route.method} ${route.pattern} (${layer.name})`;
          const real_ = { ...real, l: layer.l, f: layer.f };
          // The "missing" twin: the same shape with random uuids and a plausible revision.
          const ghost = { m: randomUUID(), l: randomUUID(), f: randomUUID(), s: randomUUID(), rev: before.revision };
          const stranger = await call(who, route.method, fill(route, real_, true), route.body?.(real_));
          const missing = await call(who, route.method, fill(route, ghost, true), route.body?.(ghost));
          expect(stranger.statusCode, label).toBe(404);
          expect(stranger.json(), label).toEqual(NOT_FOUND);
          expect(missing.statusCode, label).toBe(404);
          expect(stranger.json(), label).toEqual(missing.json());
          sweeps++;
        }
      }
    }
    // Per user: the routes without a layer id (one run), the layer routes (free and edit copy) and
    // the routes a raster layer answers (one more run each).
    expect(sweeps).toBe(2 * (MAP_ROUTES.filter((r) => !r.pattern.includes(':layerId')).length
      + 2 * MAP_ROUTES.filter((r) => r.pattern.includes(':layerId')).length + RASTER_ROUTES.size));
    expect(MAP_ROUTES.filter((r) => RASTER_ROUTES.has(`${r.method} ${r.pattern}`))).toHaveLength(RASTER_ROUTES.size);

    // The routes that are not map-scoped leak nothing either.
    for (const who of [S, A]) {
      const list = (await call(who, 'GET', '/maps')).json();
      expect(JSON.stringify(list)).not.toContain(map.id);
      expect(JSON.stringify(list)).not.toContain('Bản đồ riêng tư');
    }
    expect((await call(S, 'GET', '/admin/summary')).statusCode).toBe(403);
    const targets = await call(S, 'GET', `/share-targets?q=${encodeURIComponent('p3a-isolation-')}`);
    expect(targets.statusCode).toBe(200);
    expect(JSON.stringify(targets.json())).not.toContain(map.id);

    // Nothing the strangers sent changed anything.
    const after = (await call(O, 'GET', `/maps/${map.id}`)).json().map;
    expect(after).toEqual(before);
    expect(after.layers).toHaveLength(3);
    const { rows: cog } = await getPool().query(`SELECT delete_after FROM workspace.files WHERE id = $1`, [cogId]);
    expect(cog).toEqual([{ delete_after: null }]);
    const feats = (await call(O, 'GET', `/maps/${map.id}/layers/${free.id}/features`)).json().features;
    expect(feats).toHaveLength(1);
    expect(feats[0].properties).toEqual({ ten: 'bí mật' });
    expect((await call(O, 'GET', `/maps/${map.id}/shares`)).json().shares).toHaveLength(1);
  }, 120_000);

  it("every upload and job route answers someone else's id as a missing one", async () => {
    const owner = ids.get(O)!;
    // The owner's upload, a finished export and its file: rows only, nothing on disk is read.
    const fileId = randomUUID();
    await getPool().query(
      `INSERT INTO workspace.files (id, owner_id, kind, path, original_name, content_type, size_bytes)
       VALUES ($1, $2, 'upload', $3, 'bi-mat.geojson', 'application/geo+json', 1)`,
      [fileId, owner, `uploads/${owner}/${fileId}/original.geojson`]
    );
    const exportId = randomUUID();
    const jobId = randomUUID();
    await getPool().query(
      `INSERT INTO workspace.files (id, owner_id, kind, path, original_name, content_type, size_bytes, delete_after)
       VALUES ($1, $2, 'export', $3, 'bi-mat.gpkg', 'application/geopackage+sqlite3', 1, now() + interval '7 days')`,
      [exportId, owner, `exports/${owner}/${jobId}/bi-mat.gpkg`]
    );
    await getPool().query(
      `INSERT INTO workspace.jobs (id, owner_id, kind, status, params, result)
       VALUES ($1, $2, 'export', 'succeeded', $3, $4)`,
      [jobId, owner, JSON.stringify({ downloadName: 'bi-mat.gpkg' }), JSON.stringify({ fileId: exportId })]
    );
    const fillOwner = (pattern: string, file: string, job: string) => pattern.replace(':fileId', file).replace(':jobId', job);

    let sweeps = 0;
    for (const who of [S, A]) {
      for (const route of OWNER_ROUTES) {
        const label = `${who} ${route.method} ${route.pattern}`;
        const theirs = await call(who, route.method, fillOwner(route.pattern, fileId, jobId));
        const missing = await call(who, route.method, fillOwner(route.pattern, randomUUID(), randomUUID()));
        expect(theirs.statusCode, label).toBe(404);
        expect(theirs.json(), label).toEqual({ error: { code: 'NOT_FOUND', message: route.notFound } });
        expect(theirs.json(), label).toEqual(missing.json());
        sweeps++;
      }
      for (const list of ['/uploads', '/jobs']) {
        const res = await call(who, 'GET', list);
        expect(res.statusCode).toBe(200);
        for (const id of [fileId, exportId, jobId]) expect(res.body).not.toContain(id);
      }
    }
    expect(sweeps).toBe(2 * OWNER_ROUTES.length);

    // Nothing was removed or scheduled: the owner still has the upload, the job and its file.
    const { rows } = await getPool().query(
      `SELECT (SELECT count(*)::int FROM workspace.files WHERE id = ANY($1::uuid[])) AS files,
              (SELECT count(*)::int FROM workspace.files
                WHERE id = ANY($1::uuid[]) AND (delete_after IS NULL OR delete_after > now())) AS live,
              (SELECT count(*)::int FROM workspace.jobs WHERE id = $2) AS jobs`,
      [[fileId, exportId], jobId]
    );
    expect(rows[0]).toEqual({ files: 2, live: 2, jobs: 1 });
  });

  it('the assistant role reads nothing in workspace', async () => {
    const c = await getPool().connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE webatlas_assistant');
      // Positive control: the role does read the water views, so the refusal below is about workspace.
      const dams = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM water.dams_active`);
      expect(dams.rows[0].n).toBeGreaterThan(0);
      // A failed statement aborts the transaction; savepoints let one test try several tables.
      for (const table of ['maps', 'map_layers', 'map_shares', 'features']) {
        await c.query('SAVEPOINT t');
        await expect(c.query(`SELECT count(*) FROM workspace.${table}`), table).rejects.toMatchObject({ code: '42501' });
        await c.query('ROLLBACK TO SAVEPOINT t');
      }
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
