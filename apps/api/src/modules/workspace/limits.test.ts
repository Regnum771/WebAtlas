import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runStages } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

// The per-route request budgets of the personal reads a map view and a job poll make often, and
// the bounded wait of a write on a map row another transaction holds (a running import).

const app = buildApp();
const PW = 'p3c-limits-pass-123';
const O = 'p3c-limits-owner@webatlas.test';
let ownerId = '';
let token = '';

async function call(method: 'GET' | 'PATCH', url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method, url: `/api/workspace${url}`,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });
}

/** A map of the owner's with one free point layer, written by SQL (no request spent); revision 0. */
async function mapWithLayer() {
  const pool = getPool();
  const { rows: maps } = await pool.query<{ id: string }>(
    `INSERT INTO workspace.maps (owner_id, title) VALUES ($1, 'Giới hạn') RETURNING id`, [ownerId]
  );
  const { rows: layers } = await pool.query<{ id: string }>(
    `INSERT INTO workspace.map_layers (map_id, kind, title, position, geometry_type, fields)
     VALUES ($1, 'free', 'Điểm', 0, 'point', '[]'::jsonb) RETURNING id`,
    [maps[0].id]
  );
  return { mapId: maps[0].id, layerId: layers[0].id };
}

async function cleanupUsers() {
  // Maps, layers and features go with their owner (ON DELETE CASCADE).
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3c-limits-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanupUsers();
  const row = await usersRepository(getPool()).insert({
    email: O, password_hash: await hashPassword(PW), full_name: 'Chủ bản đồ', role: 'viewer',
  });
  ownerId = row.id;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: O, password: PW } });
  expect(login.statusCode).toBe(200);
  token = login.json().token as string;
});

afterAll(async () => {
  await runStages([cleanupUsers, () => app.close()]);
});

describe('workspace request budgets', () => {
  it('feature reads, raster ranges and job polls have their own per-address budgets', async () => {
    const { mapId, layerId } = await mapWithLayer();
    const before = await call('GET', '/maps');
    expect(before.statusCode).toBe(200);
    expect(before.headers['x-ratelimit-limit']).toBe('100');
    const globalLeft = Number(before.headers['x-ratelimit-remaining']);

    const features = await call('GET', `/maps/${mapId}/layers/${layerId}/features?bbox=100,10,110,20`);
    expect(features.statusCode).toBe(200);
    expect(features.headers['x-ratelimit-limit']).toBe('3000');

    // A free layer has no COG: the answer is a refusal, but the route's budget is the raster one.
    const raster = await call('GET', `/maps/${mapId}/layers/${layerId}/raster`);
    expect(raster.headers['x-ratelimit-limit']).toBe('6000');

    const job = await call('GET', `/jobs/${randomUUID()}`);
    expect(job.statusCode).toBe(404);
    expect(job.headers['x-ratelimit-limit']).toBe('600');

    // None of the three spent the global budget: only the next /maps read did.
    const after = await call('GET', '/maps');
    expect(after.headers['x-ratelimit-limit']).toBe('100');
    expect(Number(after.headers['x-ratelimit-remaining'])).toBe(globalLeft - 1);
  });
});

describe('a write on a busy map', () => {
  it('a write while another transaction holds the map row answers 409 MAP_BUSY within a few seconds', async () => {
    const { mapId } = await mapWithLayer();
    const holder = await getPool().connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM workspace.maps WHERE id = $1 FOR UPDATE`, [mapId]);
      const started = Date.now();
      const res = await call('PATCH', `/maps/${mapId}`, { title: 'Đổi tên', expectedRevision: 0 });
      const waited = Date.now() - started;
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: { code: 'MAP_BUSY', message: 'Bản đồ đang nhập dữ liệu; thử lại sau.' } });
      expect(waited).toBeLessThan(8000);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    // Nothing changed, and once the row is free the same write goes through.
    const retry = await call('PATCH', `/maps/${mapId}`, { title: 'Đổi tên', expectedRevision: 0 });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().map).toMatchObject({ title: 'Đổi tên', revision: 1 });
  }, 20_000);
});
