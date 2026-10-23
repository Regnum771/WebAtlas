import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStages } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { unlinkInStore } from './fileStore';

/*
 * Opt-in (WORKER_E2E=1): upload, import, export and download through the API, with the real
 * Python worker run once per job in the atlas-tools image. Needs the DB stack up and the
 * atlas-tools image built.
 *
 * The store is the repository's var/workspace-files, NOT a temp directory: the worker container
 * sees the repository at /repo, and its default store root (/repo/var/workspace-files) is this
 * same folder. This test removes only the files its own upload and jobs created, one by one with
 * unlinkInStore. It never sweeps, reconciles or deletes recursively in that store.
 */

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const STORE = path.join(REPO, 'var', 'workspace-files');
const WORKER = [
  'compose', '-f', 'infra/docker-compose.yml', '--profile', 'tools', 'run', '--rm', '-T', '--no-deps', 'tools',
  'python3', 'packages/atlas-data/tools/workspace/worker.py', '--once',
];

const PW = 'p3b-e2e-pass-123';
const O = 'p3b-e2e-owner@webatlas.test';

// Two reservoirs in Đà Nẵng, WGS 84 (GeoJSON's own CRS, so no source CRS is needed).
const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { ten: 'Hồ Hoà Trung', dung_tich: 1.5 }, geometry: { type: 'Point', coordinates: [108.05, 16.1] } },
    { type: 'Feature', properties: { ten: 'Hồ Đồng Nghệ', dung_tich: 2.25 }, geometry: { type: 'Point', coordinates: [108.08, 16.0] } },
  ],
});

/** A multipart body with one `file` part. */
function multipart(filename: string, body: Buffer) {
  const boundary = `----p3be2e${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/geo+json\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, body, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** The entry names of a zip, read from its central directory (no comment, no zip64: what GDAL/Python write). */
function zipEntryNames(buf: Buffer): string[] {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip: no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory entry');
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    names.push(buf.toString('utf8', at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

describe.skipIf(process.env.WORKER_E2E !== '1')('worker end to end', () => {
  const previousStoreDir = process.env.WORKSPACE_FILES_DIR;
  let app: ReturnType<typeof buildApp>;
  let ownerId: string;
  let token: string;
  // Store-relative paths of the files this test created; each is unlinked on its own at the end.
  const createdPaths = new Set<string>();

  async function call(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({
      method, url: `/api/workspace${url}`, headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    });
  }

  /** Every files row of the owner's, remembered so its file is removed even if the test fails later. */
  async function trackOwnerFiles() {
    const { rows } = await getPool().query<{ path: string }>(
      `SELECT path FROM workspace.files WHERE owner_id = $1`, [ownerId]
    );
    for (const r of rows) createdPaths.add(r.path);
  }

  /** Run the worker once for `jobId`, which must be the only queued job (--once takes the oldest). */
  async function runWorkerFor(jobId: string) {
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM workspace.jobs WHERE status = 'queued' AND id <> $1`, [jobId]
    );
    expect(rows, 'another queued job would be claimed before ours').toEqual([]);
    const out = execFileSync('docker', WORKER, {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000,
    });
    expect(out).toContain('ran one job');
    await trackOwnerFiles();
  }

  async function cleanupUsers() {
    // Jobs and files rows go with their owner (ON DELETE CASCADE); files on disk are unlinked first.
    await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3b-e2e-%@webatlas.test'`);
  }

  beforeAll(async () => {
    process.env.WORKSPACE_FILES_DIR = STORE;
    app = buildApp();
    await app.ready();
    await cleanupUsers();
    const row = await usersRepository(getPool()).insert({
      email: O, password_hash: await hashPassword(PW), full_name: 'Người thử đầu-cuối', role: 'viewer',
    });
    ownerId = row.id;
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: O, password: PW } });
    expect(login.statusCode).toBe(200);
    token = login.json().token as string;
  });

  afterAll(async () => {
    const pool = getPool();
    await runStages([
      async () => {
        if (ownerId) await trackOwnerFiles();
      },
      async () => {
        for (const p of createdPaths) await unlinkInStore(p);
      },
      () => pool.query(`DELETE FROM workspace.maps WHERE owner_id = $1`, [ownerId]),
      () => pool.query(`DELETE FROM app.audit_log WHERE user_id = $1`, [ownerId]),
      cleanupUsers,
      () => app?.close(),
      async () => {
        if (previousStoreDir === undefined) delete process.env.WORKSPACE_FILES_DIR;
        else process.env.WORKSPACE_FILES_DIR = previousStoreDir;
      },
    ]);
  });

  it('upload, import, export and download through the API with the real worker', async () => {
    // 1. Upload a GeoJSON.
    const { payload, headers } = multipart('Hồ chứa Đà Nẵng.geojson', Buffer.from(GEOJSON, 'utf8'));
    const up = await app.inject({
      method: 'POST', url: '/api/workspace/uploads', payload,
      headers: { ...headers, authorization: `Bearer ${token}` },
    });
    expect(up.statusCode).toBe(201);
    const uploadId = up.json().upload.id as string;
    await trackOwnerFiles();

    const created = await call('POST', '/maps', { title: 'Hồ chứa đầu-cuối' });
    expect(created.statusCode).toBe(201);
    const mapId = created.json().map.id as string;

    // 2. Queue an import; 3. the worker runs it.
    const imp = await call('POST', `/maps/${mapId}/imports`, { fileId: uploadId });
    expect(imp.statusCode).toBe(201);
    const importId = imp.json().job.id as string;
    await runWorkerFor(importId);

    // 4. The job succeeded with every step done, and the map has the layer.
    const importJob = (await call('GET', `/jobs/${importId}`)).json().job;
    expect(importJob, JSON.stringify(importJob.error)).toMatchObject({ status: 'succeeded', progress: 100, error: null });
    expect(importJob.steps.map((s: { status: string }) => s.status)).toEqual(['done', 'done', 'done']);
    const map = (await call('GET', `/maps/${mapId}`)).json().map;
    expect(map.layers).toHaveLength(1);
    expect(map.layers[0]).toMatchObject({ kind: 'free', geometryType: 'point', featureCount: 2 });
    expect(importJob.result.layerIds).toEqual([map.layers[0].id]);

    // 5. A shp export in VN-2000 TM-3 Đà Nẵng, run by the worker, then downloaded.
    const exp = await call('POST', `/maps/${mapId}/exports`, { format: 'shp', crs: 'vn2000-tm3-da-nang' });
    expect(exp.statusCode).toBe(201);
    const exportId = exp.json().job.id as string;
    await runWorkerFor(exportId);

    const exportJob = (await call('GET', `/jobs/${exportId}`)).json().job;
    expect(exportJob, JSON.stringify(exportJob.error)).toMatchObject({ status: 'succeeded', progress: 100, error: null });
    expect(exportJob.steps.map((s: { status: string }) => s.status)).toEqual(['done', 'done', 'done']);
    const dl = await call('GET', `/jobs/${exportId}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/\.zip$/);
    const zip = dl.rawPayload;
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
    const entries = zipEntryNames(zip);
    for (const ext of ['.shp', '.shx', '.dbf', '.cpg', '.prj']) {
      expect(entries.some((n) => n.toLowerCase().endsWith(ext)), `${ext} in ${entries.join(', ')}`).toBe(true);
    }

    // 6. Delete the map and the upload through the API; the rest goes in afterAll.
    const { revision } = (await call('GET', `/maps/${mapId}`)).json().map;
    expect((await call('DELETE', `/maps/${mapId}`, { expectedRevision: revision })).statusCode).toBe(204);
    expect((await call('DELETE', `/uploads/${uploadId}`)).statusCode).toBe(204);
  }, 600_000);
});
