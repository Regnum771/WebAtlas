import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type pg from 'pg';
import { discardDraft } from '@webatlas/versioning';
import { runStages } from '@webatlas/versioning/testing';
import { findCrs, shapefileFieldNames } from '@webatlas/shared';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { getLayer } from '../../layers/registry';
import type { CurrentUser } from '../../types/fastify';
import { editCopyRowsArgs } from '../layers/repository';
import { unlinkInStore, writeStream } from './fileStore';
import { uploadsService } from './uploads';

// A fresh store under the OS temp directory for this file; the previous value is restored after.
const previousStoreDir = process.env.WORKSPACE_FILES_DIR;
const STORE = mkdtempSync(path.join(os.tmpdir(), 'p3b-jobs-'));
process.env.WORKSPACE_FILES_DIR = STORE;

const app = buildApp();
const PW = 'p3b-jobs-pass-123';
const email = (who: string) => `p3b-jobs-${who}@webatlas.test`;
const O = email('owner');
const R = email('recipient');
const S = email('stranger');
const ids = new Map<string, string>();

const MAP_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Không tìm thấy bản đồ.' } };
const OWNER_ONLY = { error: { code: 'FORBIDDEN', message: 'Chỉ người tạo bản đồ được sửa bản đồ này.' } };
const SHP_WARNINGS = ['Shapefile không giữ kiểu hiển thị.', 'Mỗi loại hình học được ghi thành một tệp riêng.'];
const RASTER_WARNING = 'Lớp ảnh không được xuất; tải ảnh riêng từ lớp đó.';
const GEOJSON_WARNING = 'GeoJSON ngoài WGS 84 không theo chuẩn RFC 7946.';
const IMPORT_STEPS = [
  { key: 'read', label: 'Đọc tệp', status: 'pending' },
  { key: 'transform', label: 'Chuyển hệ toạ độ', status: 'pending' },
  { key: 'write', label: 'Ghi vào bản đồ', status: 'pending' },
];
const EXPORT_STEPS = [
  { key: 'read', label: 'Đọc dữ liệu', status: 'pending' },
  { key: 'write', label: 'Ghi tệp', status: 'pending' },
  { key: 'package', label: 'Đóng gói', status: 'pending' },
];
const JOB_KEYS = ['createdAt', 'error', 'finishedAt', 'id', 'kind', 'mapId', 'progress', 'result', 'status', 'steps'];

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

const userFor = (who: string): CurrentUser => ({
  id: ids.get(who)!, email: who, role: 'viewer', isAdmin: false, grants: [],
});

// Files this test created, as store-relative paths; each is unlinked on its own after the test.
let createdPaths: string[] = [];

/** An upload of `who`'s, stored through the service (no multipart round trip). */
async function uploadAs(who: string, filename = 'diem.geojson') {
  const { upload } = await uploadsService(getPool()).upload(userFor(who), {
    filename, mimetype: 'application/geo+json', file: Readable.from([Buffer.from('{"type":"FeatureCollection","features":[]}')]),
  });
  const { rows } = await getPool().query<{ path: string }>(`SELECT path FROM workspace.files WHERE id = $1`, [upload.id]);
  createdPaths.push(rows[0].path);
  return { ...upload, path: rows[0].path };
}

async function jobRow(jobId: string) {
  const { rows } = await getPool().query(
    `SELECT owner_id, map_id, kind, status, params, steps, progress, result, error FROM workspace.jobs WHERE id = $1`,
    [jobId]
  );
  return rows[0];
}

async function createMap(title: string) {
  const res = await call(O, 'POST', '/maps', { title });
  expect(res.statusCode).toBe(201);
  return res.json().map as { id: string; revision: number };
}

/** A free layer, written by SQL so a test can shape it freely (no request spent). */
async function insertLayer(
  mapId: string, kind: 'free' | 'raster', title: string,
  opts: { fields?: unknown[]; geometryType?: string | null; style?: Record<string, unknown> } = {}
): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO workspace.map_layers (map_id, kind, title, position, style, geometry_type, fields, raster)
     VALUES ($1, $2, $3, (SELECT COALESCE(max(position), -1) + 1 FROM workspace.map_layers WHERE map_id = $1),
             $4::jsonb, $5, $6::jsonb, $7::jsonb)
     RETURNING id`,
    [
      mapId, kind, title, JSON.stringify(opts.style ?? {}), opts.geometryType ?? null, JSON.stringify(opts.fields ?? []),
      kind === 'raster' ? JSON.stringify({ width: 1, height: 1, bands: 1 }) : null,
    ]
  );
  return rows[0].id;
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

async function cleanupUsers() {
  // Jobs and files rows go with their owner (ON DELETE CASCADE); files on disk are unlinked per test.
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3b-jobs-%@webatlas.test'`);
}

let shared: { id: string };

beforeAll(async () => {
  await app.ready();
  await cleanupUsers();
  const repo = usersRepository(getPool());
  for (const who of [O, R, S]) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role: 'viewer' });
    ids.set(who, row.id);
  }
  shared = await createMap('Bản đồ chung');
  await insertLayer(shared.id, 'free', 'Điểm chung', { geometryType: 'point', fields: [{ name: 'ten', type: 'text' }] });
  const share = await call(O, 'POST', `/maps/${shared.id}/shares`, { userId: ids.get(R)! });
  expect(share.statusCode).toBe(201);
});

afterEach(async () => {
  const paths = createdPaths;
  createdPaths = [];
  for (const p of paths) await unlinkInStore(p);
});

afterAll(async () => {
  const pool = getPool();
  const userIds = [...ids.values()];
  let drafts: string[] = [];
  await runStages([
    // The drafts our users opened (a rivers edit copy; nothing is activated, so nothing is pinned).
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
    () => pool.query(`DELETE FROM app.audit_log WHERE user_id = ANY($1::uuid[])`, [userIds]),
    cleanupUsers,
    () => app.close(),
    async () => {
      if (previousStoreDir === undefined) delete process.env.WORKSPACE_FILES_DIR;
      else process.env.WORKSPACE_FILES_DIR = previousStoreDir;
    },
  ]);
});

describe('jobs', () => {
  it('queueing an import stores the contract', async () => {
    const up = await uploadAs(O, 'Hồ chứa Đà Nẵng.geojson');
    const res = await call(O, 'POST', `/maps/${shared.id}/imports`, { fileId: up.id, sourceCrs: 'vn2000-tm3-da-nang' });
    expect(res.statusCode).toBe(201);
    const { job } = res.json();
    expect(Object.keys(job).sort()).toEqual(JOB_KEYS);
    expect(job).toMatchObject({
      kind: 'import', status: 'queued', mapId: shared.id, progress: 0, steps: IMPORT_STEPS, result: null, error: null,
      finishedAt: null,
    });
    expect(typeof job.createdAt).toBe('string');

    const row = await jobRow(job.id);
    expect(row.owner_id).toBe(ids.get(O));
    expect(row.map_id).toBe(shared.id);
    expect(row.steps).toEqual(IMPORT_STEPS);
    expect(row.params).toEqual({
      fileId: up.id, path: up.path, originalName: 'Hồ chứa Đà Nẵng.geojson', mapId: shared.id, ownerId: ids.get(O),
      maxRows: 200000,
      sourceCrs: { id: 'vn2000-tm3-da-nang', proj4: findCrs('vn2000-tm3-da-nang').proj4 },
    });

    // Without a source CRS the parameter is null; the map is not touched (the job bumps it).
    const before = (await call(O, 'GET', `/maps/${shared.id}`)).json().map.revision;
    const plain = await call(O, 'POST', `/maps/${shared.id}/imports`, { fileId: up.id });
    expect(plain.statusCode).toBe(201);
    expect((await jobRow(plain.json().job.id)).params.sourceCrs).toBeNull();
    expect((await call(O, 'GET', `/maps/${shared.id}`)).json().map.revision).toBe(before);

    // The job reads back the same, still without its parameters.
    const got = await call(O, 'GET', `/jobs/${job.id}`);
    expect(got.statusCode).toBe(200);
    expect(got.json().job).toEqual(job);

    // Someone else's upload is not the user's to import.
    const theirs = await uploadAs(S);
    const foreign = await call(O, 'POST', `/maps/${shared.id}/imports`, { fileId: theirs.id });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy tệp.' } });
  });

  it('a recipient may export but not import', async () => {
    const own = await uploadAs(R);
    const imp = await call(R, 'POST', `/maps/${shared.id}/imports`, { fileId: own.id });
    expect(imp.statusCode).toBe(403);
    expect(imp.json()).toEqual(OWNER_ONLY);

    const exp = await call(R, 'POST', `/maps/${shared.id}/exports`, { format: 'gpkg', crs: 'wgs84-dd' });
    expect(exp.statusCode).toBe(201);
    const { job } = exp.json();
    expect(job).toMatchObject({ kind: 'export', status: 'queued', mapId: shared.id, steps: EXPORT_STEPS });
    const row = await jobRow(job.id);
    // The export belongs to the recipient who asked for it.
    expect(row.owner_id).toBe(ids.get(R));
    expect(row.params.ownerId).toBe(ids.get(R));
    expect(row.steps).toEqual(EXPORT_STEPS);

    // A stranger can neither import nor export, and learns nothing about the map.
    for (const [url, body] of [
      ['imports', { fileId: own.id }], ['exports', { format: 'gpkg', crs: 'wgs84-dd' }],
    ] as const) {
      const res = await call(S, 'POST', `/maps/${shared.id}/${url}`, body);
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toEqual(MAP_NOT_FOUND);
    }
  });

  it('export params describe edit copies through editCopyRowsArgs', async () => {
    const map = await createMap('Bản đồ Sông Đà — 2026!');
    // Nothing to write yet: refused rather than queued.
    const empty = await call(O, 'POST', `/maps/${map.id}/exports`, { format: 'gpkg', crs: 'wgs84-dd' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Bản đồ không có lớp nào để xuất.' } });
    const ec = await call(O, 'POST', `/maps/${map.id}/layers`, {
      kind: 'edit_copy', layerKey: 'rivers', style: { color: '#1f78b4' }, expectedRevision: 0,
    });
    expect(ec.statusCode).toBe(201);
    const ecLayer = ec.json().layer as { id: string; title: string; draftId: string };
    const free = await call(O, 'POST', `/maps/${map.id}/layers`, {
      kind: 'free', title: 'Điểm đo', geometryType: 'point', fields: [{ name: 'ten', type: 'text' }],
      expectedRevision: 1,
    });
    expect(free.statusCode).toBe(201);
    const freeLayer = free.json().layer as { id: string };
    const raster = await insertLayer(map.id, 'raster', 'Ảnh vệ tinh');

    const res = await call(O, 'POST', `/maps/${map.id}/exports`, { format: 'shp', crs: 'vn2000-tm3-da-nang' });
    expect(res.statusCode).toBe(201);
    const { params } = await jobRow(res.json().job.id);
    const def = getLayer('rivers');
    const riverNames = shapefileFieldNames(['external_id', ...def.attributeColumns]);
    expect(params).toEqual({
      mapId: map.id, ownerId: ids.get(O), mapTitle: 'Bản đồ Sông Đà — 2026!', format: 'shp',
      crs: { id: 'vn2000-tm3-da-nang', proj4: findCrs('vn2000-tm3-da-nang').proj4 },
      downloadName: 'ban-do-song-da-2026.zip',
      layers: [
        {
          layerId: ecLayer.id, kind: 'edit_copy', title: ecLayer.title, style: { color: '#1f78b4' },
          geometryType: 'line', fields: null,
          editCopy: { ...editCopyRowsArgs(def, ecLayer.draftId), draftId: ecLayer.draftId },
          shpNames: riverNames,
        },
        {
          layerId: freeLayer.id, kind: 'free', title: 'Điểm đo', style: {}, geometryType: 'point',
          fields: [{ name: 'ten', type: 'text' }], editCopy: null, shpNames: [{ from: 'ten', to: 'ten' }],
        },
      ],
    });
    expect(params.layers[0].editCopy.relation).toBe('water.rivers_detail');
    expect(riverNames).toContainEqual({ from: 'external_id', to: 'external_i' });
    expect(params.layers.map((l: { layerId: string }) => l.layerId)).not.toContain(raster);

    // Named layers only; a single GeoJSON layer is a plain .geojson, and shpNames are for shp only.
    const one = await call(O, 'POST', `/maps/${map.id}/exports`, { format: 'geojson', crs: 'wgs84-dms', layerIds: [freeLayer.id] });
    expect(one.statusCode).toBe(201);
    const p1 = (await jobRow(one.json().job.id)).params;
    expect(p1.downloadName).toBe('ban-do-song-da-2026.geojson');
    expect(p1.layers.map((l: { layerId: string }) => l.layerId)).toEqual([freeLayer.id]);
    expect(p1.layers[0].shpNames).toBeNull();
  });

  it('the shapefile preview lists cut names and warns', async () => {
    const map = await createMap('Xem trước');
    const drawn = await call(O, 'POST', `/maps/${map.id}/layers`, {
      kind: 'free', title: 'Công trình', geometryType: 'point',
      fields: [{ name: 'ten_cong_trinh_thuy_loi', type: 'text' }, { name: 'ten', type: 'text' }],
      expectedRevision: 0,
    });
    expect(drawn.statusCode).toBe(201);
    const drawnId = drawn.json().layer.id as string;
    // An imported layer declares no fields: its names are the keys its features carry.
    const imported = await insertLayer(map.id, 'free', 'Nhập từ tệp');
    await getPool().query(
      `INSERT INTO workspace.features (layer_id, geom, properties)
       VALUES ($1, ST_SetSRID(ST_MakePoint(108.2, 16.05), 4326), '{"dung_tich_ho_chua": 1, "ma": "A"}'),
              ($1, ST_SetSRID(ST_MakePoint(108.3, 16.05), 4326), '{"dung_tich_ho_chua_2": 2, "ma": "B"}')`,
      [imported]
    );

    const res = await call(O, 'GET', `/maps/${map.id}/exports/preview?format=shp&crs=wgs84-dd`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      layers: [
        { layerId: drawnId, title: 'Công trình', truncated: [{ from: 'ten_cong_trinh_thuy_loi', to: 'ten_cong_t' }] },
        {
          layerId: imported, title: 'Nhập từ tệp',
          truncated: [{ from: 'dung_tich_ho_chua', to: 'dung_tich_' }, { from: 'dung_tich_ho_chua_2', to: 'dung_tic_1' }],
        },
      ],
      warnings: SHP_WARNINGS,
    });

    // A raster layer is skipped, with a warning.
    const raster = await insertLayer(map.id, 'raster', 'Ảnh');
    const withRaster = await call(O, 'GET', `/maps/${map.id}/exports/preview?format=gpkg&crs=wgs84-dd`);
    expect(withRaster.json()).toEqual({
      layers: [
        { layerId: drawnId, title: 'Công trình', truncated: [] },
        { layerId: imported, title: 'Nhập từ tệp', truncated: [] },
      ],
      warnings: [RASTER_WARNING],
    });

    // GeoJSON outside WGS 84; layerIds narrows the preview (comma-separated), a named raster is skipped.
    const geo = await call(O, 'GET', `/maps/${map.id}/exports/preview?format=geojson&crs=vn2000-utm48&layerIds=${drawnId},${raster}`);
    expect(geo.statusCode).toBe(200);
    expect(geo.json()).toEqual({
      layers: [{ layerId: drawnId, title: 'Công trình', truncated: [] }],
      warnings: [RASTER_WARNING, GEOJSON_WARNING],
    });
    const wgs = await call(O, 'GET', `/maps/${map.id}/exports/preview?format=geojson&crs=wgs84-dms&layerIds=${drawnId}`);
    expect(wgs.json().warnings).toEqual([]);

    // A recipient may preview; a layer id that is not in the map is refused.
    const recip = await call(R, 'GET', `/maps/${shared.id}/exports/preview?format=shp&crs=wgs84-dd`);
    expect(recip.statusCode).toBe(200);
    const missing = await call(O, 'GET', `/maps/${map.id}/exports/preview?format=shp&crs=wgs84-dd&layerIds=${randomUUID()}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy lớp.' } });
  });

  it('an edit copy whose draft is gone is skipped with a warning', async () => {
    const map = await createMap('Bản nháp mất');
    const ec = await call(O, 'POST', `/maps/${map.id}/layers`, { kind: 'edit_copy', layerKey: 'rivers', expectedRevision: 0 });
    expect(ec.statusCode).toBe(201);
    const ecLayer = ec.json().layer as { id: string; title: string };
    const free = await insertLayer(map.id, 'free', 'Điểm', { geometryType: 'point', fields: [{ name: 'đập', type: 'text' }] });
    // The draft is discarded elsewhere; the layer row outlives it with draft_id NULL.
    await getPool().query(`UPDATE workspace.map_layers SET draft_id = NULL WHERE id = $1`, [ecLayer.id]);
    const gone = `Lớp "${ecLayer.title}" không còn bản nháp nên không được xuất.`;

    const preview = await call(O, 'GET', `/maps/${map.id}/exports/preview?format=shp&crs=wgs84-dd`);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({
      // A folded name is a changed name, so it is listed.
      layers: [{ layerId: free, title: 'Điểm', truncated: [{ from: 'đập', to: 'dap' }] }],
      warnings: [...SHP_WARNINGS, gone],
    });

    const res = await call(O, 'POST', `/maps/${map.id}/exports`, { format: 'gpkg', crs: 'wgs84-dd' });
    expect(res.statusCode).toBe(201);
    expect(res.json().warnings).toEqual([gone]);
    const { params } = await jobRow(res.json().job.id);
    expect(params.layers.map((l: { layerId: string }) => l.layerId)).toEqual([free]);

    // With only that layer left, there is nothing to export.
    const only = await call(O, 'POST', `/maps/${map.id}/exports`, { format: 'gpkg', crs: 'wgs84-dd', layerIds: [ecLayer.id] });
    expect(only.statusCode).toBe(400);
    expect(only.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Bản đồ không có lớp nào để xuất.' } });
  });

  it('jobs are private', async () => {
    const res = await call(O, 'POST', `/maps/${shared.id}/exports`, { format: 'gpkg', crs: 'wgs84-dd' });
    expect(res.statusCode).toBe(201);
    const jobId = res.json().job.id as string;

    for (const url of [`/jobs/${jobId}`, `/jobs/${jobId}/download`]) {
      const stranger = await call(S, 'GET', url);
      const missing = await call(S, 'GET', url.replace(jobId, randomUUID()));
      expect(stranger.statusCode, url).toBe(404);
      expect(stranger.json(), url).toEqual(missing.json());
    }
    // Not even the map's recipient sees the owner's job.
    expect((await call(R, 'GET', `/jobs/${jobId}`)).statusCode).toBe(404);
    const theirs = await call(S, 'GET', '/jobs');
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json().jobs.map((j: { id: string }) => j.id)).not.toContain(jobId);

    // The owner's list, newest first, filtered by map.
    const mine = await call(O, 'GET', `/jobs?mapId=${shared.id}`);
    expect(mine.statusCode).toBe(200);
    const list = mine.json().jobs as Array<{ id: string; mapId: string; params?: unknown }>;
    expect(list[0].id).toBe(jobId);
    expect(list.every((j) => j.mapId === shared.id && !('params' in j))).toBe(true);
    const other = await call(O, 'GET', `/jobs?mapId=${randomUUID()}`);
    expect(other.json().jobs).toEqual([]);
  });

  it('download is refused until the export succeeds', async () => {
    const res = await call(O, 'POST', `/maps/${shared.id}/exports`, { format: 'gpkg', crs: 'wgs84-dd' });
    expect(res.statusCode).toBe(201);
    const jobId = res.json().job.id as string;
    const { params } = await jobRow(jobId);
    expect(params.downloadName).toBe('ban-do-chung.gpkg');

    const queued = await call(O, 'GET', `/jobs/${jobId}/download`);
    expect(queued.statusCode).toBe(404);

    // Stand in for the worker: the file, its row and the job's result.
    const rel = `exports/${ids.get(O)}/${jobId}/${params.downloadName}`;
    const body = Buffer.from('gpkg-bytes-for-the-test');
    createdPaths.push(rel);
    await writeStream(rel, Readable.from([body]), 1024);
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes, delete_after)
       VALUES ($1, 'export', $2, $3, 'application/octet-stream', $4, now() + interval '7 days') RETURNING id`,
      [ids.get(O), rel, params.downloadName, body.length]
    );
    await getPool().query(
      `UPDATE workspace.jobs SET status = 'succeeded', progress = 100, finished_at = now(), result = $2::jsonb
        WHERE id = $1`,
      [jobId, JSON.stringify({ fileId: rows[0].id })]
    );

    const ok = await call(O, 'GET', `/jobs/${jobId}/download`);
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.equals(body)).toBe(true);
    expect(ok.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''ban-do-chung.gpkg`);
    expect(ok.headers['content-type']).toBe('application/geopackage+sqlite3');
    expect((await call(O, 'GET', `/jobs/${jobId}`)).json().job).toMatchObject({
      status: 'succeeded', result: { fileId: rows[0].id },
    });

    // An expired export is gone, whether or not the file has been removed yet.
    await getPool().query(`UPDATE workspace.files SET delete_after = now() - interval '1 minute' WHERE id = $1`, [rows[0].id]);
    expect((await call(O, 'GET', `/jobs/${jobId}/download`)).statusCode).toBe(404);
  });

  it('deleting a finished export frees its quota at once and its download answers 404', async () => {
    const res = await call(O, 'POST', `/maps/${shared.id}/exports`, { format: 'gpkg', crs: 'wgs84-dd' });
    expect(res.statusCode).toBe(201);
    const jobId = res.json().job.id as string;
    const { params } = await jobRow(jobId);

    // Stand in for the worker: the file, its row and the job's result.
    const rel = `exports/${ids.get(O)}/${jobId}/${params.downloadName}`;
    const body = Buffer.from('an-export-that-takes-up-some-room');
    createdPaths.push(rel);
    await writeStream(rel, Readable.from([body]), 1024);
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes, delete_after)
       VALUES ($1, 'export', $2, $3, 'application/octet-stream', $4, now() + interval '7 days') RETURNING id`,
      [ids.get(O), rel, params.downloadName, body.length]
    );
    const fileId = rows[0].id;
    await getPool().query(
      `UPDATE workspace.jobs SET status = 'succeeded', progress = 100, finished_at = now(), result = $2::jsonb
        WHERE id = $1`,
      [jobId, JSON.stringify({ fileId })]
    );
    const before = (await call(O, 'GET', '/uploads')).json().usageBytes as number;
    expect((await call(O, 'GET', `/jobs/${jobId}/download`)).statusCode).toBe(200);

    const removed = await call(O, 'DELETE', `/jobs/${jobId}`);
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe('');

    // The file no longer counts against the quota, from the very next request.
    expect((await call(O, 'GET', '/uploads')).json().usageBytes).toBe(before - body.length);
    // The job is gone, and with it the download.
    for (const url of [`/jobs/${jobId}`, `/jobs/${jobId}/download`]) {
      const gone = await call(O, 'GET', url);
      expect(gone.statusCode, url).toBe(404);
      expect(gone.json(), url).toEqual({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy công việc.' } });
    }
    expect(await jobRow(jobId)).toBeUndefined();
    // The row is scheduled for the sweep, not removed: the API never unlinks a file.
    const { rows: file } = await getPool().query<{ due: boolean }>(
      `SELECT delete_after <= now() AS due FROM workspace.files WHERE id = $1`, [fileId]
    );
    expect(file).toEqual([{ due: true }]);
    expect(existsSync(path.join(STORE, ...rel.split('/')))).toBe(true);

    // Deleting it again is a missing job.
    const again = await call(O, 'DELETE', `/jobs/${jobId}`);
    expect(again.statusCode).toBe(404);
    expect(again.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy công việc.' } });
  });

  it('a running job cannot be deleted (409 JOB_RUNNING)', async () => {
    const res = await call(O, 'POST', `/maps/${shared.id}/exports`, { format: 'gpkg', crs: 'wgs84-dd' });
    expect(res.statusCode).toBe(201);
    const jobId = res.json().job.id as string;
    const running = { error: { code: 'JOB_RUNNING', message: 'Công việc đang chạy, chưa xoá được.' } };

    for (const status of ['queued', 'running']) {
      await getPool().query(`UPDATE workspace.jobs SET status = $2 WHERE id = $1`, [jobId, status]);
      const refused = await call(O, 'DELETE', `/jobs/${jobId}`);
      expect(refused.statusCode, status).toBe(409);
      expect(refused.json(), status).toEqual(running);
      expect((await jobRow(jobId))?.status, status).toBe(status);
    }

    // Once it has failed it can go; a failed export has no file to schedule.
    await getPool().query(
      `UPDATE workspace.jobs SET status = 'failed', error = 'X', finished_at = now() WHERE id = $1`, [jobId]
    );
    // Someone else, even the map's recipient, gets the missing job's 404, and the job stays.
    const theirs = await call(R, 'DELETE', `/jobs/${jobId}`);
    expect(theirs.statusCode).toBe(404);
    expect(theirs.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy công việc.' } });
    expect(await jobRow(jobId)).toBeDefined();
    expect((await call(O, 'DELETE', `/jobs/${jobId}`)).statusCode).toBe(204);
    expect(await jobRow(jobId)).toBeUndefined();
  });

  it('unknown CRS id is refused', async () => {
    const up = await uploadAs(O);
    const cases = [
      call(O, 'POST', `/maps/${shared.id}/imports`, { fileId: up.id, sourceCrs: 'epsg-9999' }),
      call(O, 'POST', `/maps/${shared.id}/exports`, { format: 'gpkg', crs: 'epsg-9999' }),
      call(O, 'GET', `/maps/${shared.id}/exports/preview?format=gpkg&crs=epsg-9999`),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM workspace.jobs WHERE params->>'fileId' = $1`, [up.id]);
    expect(rows[0].n).toBe(0);
  });
});
