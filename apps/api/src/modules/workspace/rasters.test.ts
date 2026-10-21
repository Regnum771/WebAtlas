import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runStages } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { unlinkInStore } from './fileStore';

// A fresh store under the OS temp directory for this file; the previous value is restored after.
const previousStoreDir = process.env.WORKSPACE_FILES_DIR;
const STORE = mkdtempSync(path.join(os.tmpdir(), 'p3b-rasters-'));
process.env.WORKSPACE_FILES_DIR = STORE;

const app = buildApp();
const PW = 'p3b-rasters-pass-123';
const email = (who: string) => `p3b-rasters-${who}@webatlas.test`;
const O = email('owner');
const R = email('recipient');
const S = email('stranger');
const A = email('admin'); // admin rights grant no read access to someone else's map
const ids = new Map<string, string>();

const MAP_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Không tìm thấy bản đồ.' } };
const FILE_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Không tìm thấy tệp.' } };
const UNSUPPORTED_KIND = { error: { code: 'VALIDATION_ERROR', message: 'Loại lớp này chưa hỗ trợ thao tác này.' } };

// The stored "COG": 1000 bytes, each telling its own offset (mod 251).
const BODY = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

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
async function get(who: string, url: string, range?: string) {
  return app.inject({
    method: 'GET', url: `/api/workspace${url}`,
    headers: { authorization: `Bearer ${await tokenFor(who)}`, ...(range ? { range } : {}) },
  });
}
async function send(who: string, method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method, url: `/api/workspace${url}`,
    headers: { authorization: `Bearer ${await tokenFor(who)}` },
    ...(payload ? { payload } : {}),
  });
}

const META = { width: 64, height: 64, bands: 1, dtype: 'uint8', nodata: null };

/** The regular files in a user's COG directory (read only). */
function cogFilesOf(userId: string): string[] {
  const dir = path.join(STORE, 'cog', userId);
  return existsSync(dir) ? readdirSync(dir) : [];
}

// What setup creates: the map, its layers and the store-relative paths of the files on disk.
let mapId = '';
let raster = ''; // a raster layer whose COG is on disk
let noFile = ''; // a raster layer whose files row is gone (file_id NULL)
let lostFile = ''; // a raster layer whose files row is there but not the file
let free = '';
const createdPaths: string[] = [];
const rasterUrl = (layerId: string, map = mapId) => `/maps/${map}/layers/${layerId}/raster`;

async function cleanupUsers() {
  // Maps, layers and files rows go with their owner (ON DELETE CASCADE).
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3b-rasters-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanupUsers();
  const pool = getPool();
  const repo = usersRepository(pool);
  for (const [who, role] of [[O, 'viewer'], [R, 'viewer'], [S, 'viewer'], [A, 'admin']] as const) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role });
    ids.set(who, row.id);
  }
  const owner = ids.get(O)!;
  mapId = (await pool.query<{ id: string }>(
    `INSERT INTO workspace.maps (owner_id, title) VALUES ($1, 'Bản đồ ảnh') RETURNING id`, [owner]
  )).rows[0].id;
  await pool.query(`INSERT INTO workspace.map_shares (map_id, user_id, created_by) VALUES ($1, $2, $3)`, [mapId, ids.get(R), owner]);

  /** A cog files row (and, when onDisk, its file) plus a raster layer pointing at it. */
  async function rasterLayer(position: number, onDisk: boolean) {
    const fileId = randomUUID();
    const rel = `cog/${owner}/${fileId}.tif`;
    if (onDisk) {
      mkdirSync(path.join(STORE, 'cog', owner), { recursive: true });
      writeFileSync(path.join(STORE, rel), BODY);
      createdPaths.push(rel);
    }
    await pool.query(
      `INSERT INTO workspace.files (id, owner_id, kind, path, original_name, content_type, size_bytes)
       VALUES ($1, $2, 'cog', $3, 'anh.tif', 'image/tiff', $4)`,
      [fileId, owner, rel, BODY.length]
    );
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO workspace.map_layers (map_id, kind, title, position, file_id, raster)
       VALUES ($1, 'raster', 'Ảnh', $2, $3, $4) RETURNING id`,
      [mapId, position, fileId, META]
    );
    return { layerId: rows[0].id, fileId };
  }
  raster = (await rasterLayer(0, true)).layerId;
  const gone = await rasterLayer(1, false);
  noFile = gone.layerId;
  await pool.query(`DELETE FROM workspace.files WHERE id = $1`, [gone.fileId]); // file_id goes NULL
  lostFile = (await rasterLayer(2, false)).layerId;
  free = (await pool.query<{ id: string }>(
    `INSERT INTO workspace.map_layers (map_id, kind, title, position, geometry_type)
     VALUES ($1, 'free', 'Điểm', 3, 'point') RETURNING id`, [mapId]
  )).rows[0].id;
});

afterAll(async () => {
  await runStages([
    async () => {
      // The files setup wrote, and any COG a copy wrote for a test user; each unlinked on its own.
      const { rows } = await getPool().query<{ path: string }>(
        `SELECT path FROM workspace.files WHERE owner_id = ANY($1::uuid[])`, [[...ids.values()]]
      );
      for (const rel of new Set([...createdPaths, ...rows.map((r) => r.path)])) await unlinkInStore(rel);
    },
    cleanupUsers,
    () => app.close(),
    async () => {
      if (previousStoreDir === undefined) delete process.env.WORKSPACE_FILES_DIR;
      else process.env.WORKSPACE_FILES_DIR = previousStoreDir;
    },
  ]);
});

describe('raster layers', () => {
  it('range requests return 206 with the right bytes', async () => {
    const whole = await get(O, rasterUrl(raster));
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['content-type']).toBe('image/tiff');
    expect(whole.headers['accept-ranges']).toBe('bytes');
    expect(whole.headers['content-length']).toBe('1000');
    expect(whole.rawPayload.equals(BODY)).toBe(true);

    for (const [range, start, end] of [
      ['bytes=0-99', 0, 99],
      ['bytes=900-', 900, 999],
      ['bytes=990-5000', 990, 999], // the end is clamped to the file
      ['bytes=-10', 990, 999], // the last 10 bytes
    ] as const) {
      const res = await get(O, rasterUrl(raster), range);
      expect(res.statusCode, range).toBe(206);
      expect(res.headers['content-range'], range).toBe(`bytes ${start}-${end}/1000`);
      expect(res.headers['content-length'], range).toBe(String(end - start + 1));
      expect(res.headers['content-type'], range).toBe('image/tiff');
      expect(res.headers['accept-ranges'], range).toBe('bytes');
      expect(res.rawPayload.equals(BODY.subarray(start, end + 1)), range).toBe(true);
    }

    // Several ranges, or one that does not parse, are ignored: the whole file, as RFC 9110 allows.
    for (const range of ['bytes=0-1,5-6', 'bytes=abc', 'bytes=9-3', 'items=0-1']) {
      const res = await get(O, rasterUrl(raster), range);
      expect(res.statusCode, range).toBe(200);
      expect(res.rawPayload.equals(BODY), range).toBe(true);
    }
  });

  it('bad range gets 416', async () => {
    for (const range of ['bytes=1000-', 'bytes=5000-6000', 'bytes=-0']) {
      const res = await get(O, rasterUrl(raster), range);
      expect(res.statusCode, range).toBe(416);
      expect(res.headers['content-range'], range).toBe('bytes */1000');
      expect(res.headers['accept-ranges'], range).toBe('bytes');
    }
  });

  it('a stranger gets 404 identical to a missing map, a recipient gets 200', async () => {
    for (const who of [S, A]) {
      const stranger = await get(who, rasterUrl(raster), 'bytes=0-9');
      const missing = await get(who, rasterUrl(randomUUID(), randomUUID()), 'bytes=0-9');
      expect(stranger.statusCode, who).toBe(404);
      expect(stranger.json(), who).toEqual(MAP_NOT_FOUND);
      expect(missing.statusCode, who).toBe(404);
      expect(stranger.json(), who).toEqual(missing.json());
    }

    const whole = await get(R, rasterUrl(raster));
    expect(whole.statusCode).toBe(200);
    expect(whole.rawPayload.equals(BODY)).toBe(true);
    const part = await get(R, rasterUrl(raster), 'bytes=10-19');
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.equals(BODY.subarray(10, 20))).toBe(true);
  });

  it('a layer that is not a raster gets 400, a raster without its file gets 404', async () => {
    const notRaster = await get(O, rasterUrl(free));
    expect(notRaster.statusCode).toBe(400);
    expect(notRaster.json()).toEqual(UNSUPPORTED_KIND);

    for (const layerId of [noFile, lostFile]) {
      const res = await get(O, rasterUrl(layerId));
      expect(res.statusCode, layerId).toBe(404);
      expect(res.json(), layerId).toEqual(FILE_NOT_FOUND);
    }

    const noLayer = await get(O, rasterUrl(randomUUID()));
    expect(noLayer.statusCode).toBe(404);
    expect(noLayer.json().error.code).toBe('NOT_FOUND');
  });

  it('the map lists raster metadata, never the file id', async () => {
    const res = await get(R, `/maps/${mapId}`);
    expect(res.statusCode).toBe(200);
    const layers = res.json().map.layers as Array<Record<string, unknown>>;
    expect(layers.map((l) => l.kind)).toEqual(['raster', 'raster', 'raster', 'free']);
    expect(layers.find((l) => l.id === raster)!.raster).toEqual(META);
    expect(layers.find((l) => l.id === free)!.raster).toBeNull();
    expect(JSON.stringify(layers)).not.toMatch(/file_?id/i);
  });

  it('a raster layer is renamed, restyled and moved, but not deleted yet', async () => {
    const forbidden = await send(R, 'PATCH', `/maps/${mapId}/layers/${raster}`, { title: 'Không được', expectedRevision: 0 });
    expect(forbidden.statusCode).toBe(403);

    const res = await send(O, 'PATCH', `/maps/${mapId}/layers/${raster}`, {
      title: 'Ảnh mới', style: { opacity: 0.6 }, position: 2, expectedRevision: 0,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      revision: 1,
      layer: { id: raster, kind: 'raster', title: 'Ảnh mới', style: { opacity: 0.6 }, position: 2, raster: META, featureCount: null },
    });
    const order = (await get(O, `/maps/${mapId}`)).json().map.layers.map((l: { id: string }) => l.id);
    expect(order).toEqual([noFile, lostFile, raster, free]);

    const removed = await send(O, 'DELETE', `/maps/${mapId}/layers/${raster}`, { expectedRevision: 1 });
    expect(removed.statusCode).toBe(400);
    expect(removed.json()).toEqual(UNSUPPORTED_KIND);
  });

  it('a copier over the quota gets 413 and nothing is created', async () => {
    const recipient = ids.get(R)!;
    await getPool().query(`UPDATE app.users SET quota_bytes = 500 WHERE id = $1`, [recipient]);
    try {
      const res = await send(R, 'POST', `/maps/${mapId}/copy`);
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
      expect(res.json().error.message).toBe('Vượt hạn mức dung lượng: đã dùng 0,0 MB, hạn mức 0,0 MB.');
    } finally {
      await getPool().query(`UPDATE app.users SET quota_bytes = DEFAULT WHERE id = $1`, [recipient]);
    }
    const counts = await getPool().query<{ maps: number; files: number; layers: number }>(
      `SELECT (SELECT count(*)::int FROM workspace.maps WHERE owner_id = $1) AS maps,
              (SELECT count(*)::int FROM workspace.files WHERE owner_id = $1) AS files,
              (SELECT count(*)::int FROM workspace.map_layers l JOIN workspace.maps m ON m.id = l.map_id
                WHERE m.owner_id = $1) AS layers`,
      [recipient]
    );
    expect(counts.rows[0]).toEqual({ maps: 0, files: 0, layers: 0 });
    expect(cogFilesOf(recipient)).toEqual([]);
  });

  it('copying a map with a raster layer gives the copier an independent COG', async () => {
    const recipient = ids.get(R)!;
    const res = await send(R, 'POST', `/maps/${mapId}/copy`);
    expect(res.statusCode).toBe(201);
    const copy = res.json().map;
    // The rasters whose file is gone (file_id NULL, or missing on disk) are skipped; positions close up.
    expect(copy.layers.map((l: { kind: string; position: number }) => [l.kind, l.position])).toEqual([['raster', 0], ['free', 1]]);
    const copied = copy.layers[0];
    expect(copied).toMatchObject({ kind: 'raster', title: 'Ảnh mới', style: { opacity: 0.6 }, raster: META });
    expect(copied.id).not.toBe(raster);

    const { rows } = await getPool().query<{ layer: string; owner_id: string; kind: string; path: string }>(
      `SELECT l.id AS layer, f.owner_id, f.kind, f.path
         FROM workspace.map_layers l JOIN workspace.files f ON f.id = l.file_id
        WHERE l.id = ANY($1::uuid[])`,
      [[raster, copied.id]]
    );
    const source = rows.find((r) => r.layer === raster)!;
    const theirs = rows.find((r) => r.layer === copied.id)!;
    expect(theirs).toMatchObject({ owner_id: recipient, kind: 'cog' });
    expect(theirs.path).toMatch(new RegExp(`^cog/${recipient}/[0-9a-f-]{36}\\.tif$`));
    expect(theirs.path).not.toBe(source.path);
    expect(readFileSync(path.join(STORE, theirs.path)).equals(BODY)).toBe(true);

    // The copy serves its own COG to its owner, and is no one else's.
    const served = await get(R, rasterUrl(copied.id, copy.id));
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(BODY)).toBe(true);
    expect((await get(O, rasterUrl(copied.id, copy.id))).statusCode).toBe(404);
  });
});
