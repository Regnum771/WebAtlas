import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runStages } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const PW = 'p3a-maps-pass-123';
const email = (who: string) => `p3a-maps-${who}@webatlas.test`;
const O = email('owner');
const R = email('recipient');
const S = email('stranger');
const A = email('admin'); // admin rights grant no read access to someone else's map
const ids = new Map<string, string>();

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Không tìm thấy bản đồ.' } };
const OWNER_ONLY = 'Chỉ người tạo bản đồ được sửa bản đồ này.';
const MAP_CHANGED = 'Bản đồ đã thay đổi ở nơi khác.';

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
const auth = async (who: string) => ({ authorization: `Bearer ${await tokenFor(who)}` });

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
async function call(who: string, method: Method, url: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url: `/api/workspace${url}`, headers: await auth(who), ...(payload ? { payload } : {}) });
}

async function createMap(who: string, title: string, description?: string) {
  const res = await call(who, 'POST', '/maps', { title, ...(description !== undefined ? { description } : {}) });
  expect(res.statusCode).toBe(201);
  return res.json().map as { id: string; title: string; revision: number };
}

async function shareWith(mapId: string, who: string) {
  await getPool().query(
    `INSERT INTO workspace.map_shares (map_id, user_id, created_by) VALUES ($1, $2, $3)`,
    [mapId, ids.get(who), ids.get(O)]
  );
}

async function cleanupUsers() {
  // Maps, layers, features and shares go with their owner (ON DELETE CASCADE).
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3a-maps-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanupUsers();
  const repo = usersRepository(getPool());
  for (const [who, role, name] of [
    [O, 'viewer', 'Chủ bản đồ'], [R, 'viewer', 'Người nhận'], [S, 'viewer', 'Người lạ'], [A, 'admin', 'Quản trị'],
  ] as const) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: name, role });
    ids.set(who, row.id);
  }
});

afterAll(async () => {
  await runStages([cleanupUsers, () => app.close()]);
});

describe('personal maps', () => {
  it('owner creates, reads, renames and deletes a map', async () => {
    const created = await call(O, 'POST', '/maps', { title: '  Bản đồ thử  ', description: 'Mô tả' });
    expect(created.statusCode).toBe(201);
    const map = created.json().map;
    expect(map).toMatchObject({
      title: 'Bản đồ thử', description: 'Mô tả', ownerId: ids.get(O), ownerName: 'Chủ bản đồ',
      revision: 0, layerCount: 0, role: 'owner', layers: [],
    });
    expect(typeof map.updatedAt).toBe('string');

    const read = await call(O, 'GET', `/maps/${map.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json().map).toEqual(map);

    const renamed = await call(O, 'PATCH', `/maps/${map.id}`, { title: 'Đổi tên', expectedRevision: 0 });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().map).toMatchObject({ id: map.id, title: 'Đổi tên', description: 'Mô tả', revision: 1 });

    const removed = await call(O, 'DELETE', `/maps/${map.id}`, { expectedRevision: 1 });
    expect(removed.statusCode).toBe(204);
    const gone = await call(O, 'GET', `/maps/${map.id}`);
    expect(gone.statusCode).toBe(404);
    const { rows } = await getPool().query(`SELECT 1 FROM workspace.maps WHERE id = $1`, [map.id]);
    expect(rows).toHaveLength(0);
  });

  it('list separates mine from shared with me', async () => {
    const ownMap = await createMap(O, 'Của chủ');
    const recipientsOwn = await createMap(R, 'Của người nhận');
    await shareWith(ownMap.id, R);

    const forOwner = (await call(O, 'GET', '/maps')).json();
    expect(forOwner.mine.map((m: { id: string }) => m.id)).toContain(ownMap.id);
    expect(forOwner.mine.find((m: { id: string }) => m.id === ownMap.id)).toMatchObject({ role: 'owner', layerCount: 0 });
    expect(forOwner.mine.map((m: { id: string }) => m.id)).not.toContain(recipientsOwn.id);
    expect(forOwner.sharedWithMe).toEqual([]);

    const forRecipient = (await call(R, 'GET', '/maps')).json();
    expect(forRecipient.mine.map((m: { id: string }) => m.id)).toEqual([recipientsOwn.id]);
    expect(forRecipient.sharedWithMe).toHaveLength(1);
    expect(forRecipient.sharedWithMe[0]).toMatchObject({
      id: ownMap.id, title: 'Của chủ', ownerId: ids.get(O), ownerName: 'Chủ bản đồ', role: 'recipient',
    });
    expect(forRecipient.sharedWithMe[0].layers).toBeUndefined();

    const forStranger = (await call(S, 'GET', '/maps')).json();
    expect(forStranger).toEqual({ mine: [], sharedWithMe: [] });
  });

  it('list is ordered by most recently updated first', async () => {
    const older = await createMap(O, 'Cũ hơn');
    const newer = await createMap(O, 'Mới hơn');
    await call(O, 'PATCH', `/maps/${older.id}`, { title: 'Cũ hơn, vừa sửa', expectedRevision: 0 });
    const mine = (await call(O, 'GET', '/maps')).json().mine.map((m: { id: string }) => m.id);
    expect(mine.indexOf(older.id)).toBeLessThan(mine.indexOf(newer.id));
  });

  it('a stranger gets 404 for get, patch and delete, and the same body as for a random uuid', async () => {
    const map = await createMap(O, 'Riêng tư');
    const missing = randomUUID();
    for (const who of [S, A]) {
      for (const [method, payload] of [
        ['GET', undefined], ['PATCH', { title: 'x', expectedRevision: 0 }], ['DELETE', { expectedRevision: 0 }],
      ] as const) {
        const real = await call(who, method, `/maps/${map.id}`, payload);
        const random = await call(who, method, `/maps/${missing}`, payload);
        expect(real.statusCode).toBe(404);
        expect(random.statusCode).toBe(404);
        expect(real.json()).toEqual(NOT_FOUND);
        expect(real.body).toBe(random.body);
      }
    }
    const { rows } = await getPool().query(`SELECT title, revision FROM workspace.maps WHERE id = $1`, [map.id]);
    expect(rows[0]).toEqual({ title: 'Riêng tư', revision: 0 });
  });

  it('a recipient reads but cannot write', async () => {
    const map = await createMap(O, 'Chia sẻ');
    await shareWith(map.id, R);
    const read = await call(R, 'GET', `/maps/${map.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json().map).toMatchObject({ id: map.id, role: 'recipient', layers: [] });

    const patch = await call(R, 'PATCH', `/maps/${map.id}`, { title: 'Chiếm', expectedRevision: 0 });
    expect(patch.statusCode).toBe(403);
    expect(patch.json().error).toEqual({ code: 'FORBIDDEN', message: OWNER_ONLY });
    const del = await call(R, 'DELETE', `/maps/${map.id}`, { expectedRevision: 0 });
    expect(del.statusCode).toBe(403);
    expect(del.json().error).toEqual({ code: 'FORBIDDEN', message: OWNER_ONLY });

    const { rows } = await getPool().query(`SELECT title, revision FROM workspace.maps WHERE id = $1`, [map.id]);
    expect(rows[0]).toEqual({ title: 'Chia sẻ', revision: 0 });
  });

  it('a stale revision changes nothing', async () => {
    const map = await createMap(O, 'Hai thẻ');
    const first = await call(O, 'PATCH', `/maps/${map.id}`, { title: 'Thẻ một', expectedRevision: 0 });
    expect(first.statusCode).toBe(200);
    const stale = await call(O, 'PATCH', `/maps/${map.id}`, { title: 'Thẻ hai', expectedRevision: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toEqual({ code: 'MAP_CHANGED', message: MAP_CHANGED });
    const staleDelete = await call(O, 'DELETE', `/maps/${map.id}`, { expectedRevision: 0 });
    expect(staleDelete.statusCode).toBe(409);
    expect(staleDelete.json().error.code).toBe('MAP_CHANGED');

    const read = (await call(O, 'GET', `/maps/${map.id}`)).json().map;
    expect(read).toMatchObject({ title: 'Thẻ một', revision: 1 });
  });

  it('a write without expectedRevision is refused', async () => {
    const map = await createMap(O, 'Thiếu phiên bản');
    const patch = await call(O, 'PATCH', `/maps/${map.id}`, { title: 'x' });
    expect(patch.statusCode).toBe(400);
    const del = await call(O, 'DELETE', `/maps/${map.id}`);
    expect(del.statusCode).toBe(400);
  });

  it('an archived map is invisible, even to its owner', async () => {
    const map = await createMap(O, 'Lưu trữ');
    await shareWith(map.id, R);
    await getPool().query(`UPDATE workspace.maps SET archived_at = now() WHERE id = $1`, [map.id]);
    for (const who of [O, R]) {
      const res = await call(who, 'GET', `/maps/${map.id}`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(NOT_FOUND);
      const lists = (await call(who, 'GET', '/maps')).json();
      expect(lists.mine.map((m: { id: string }) => m.id)).not.toContain(map.id);
      expect(lists.sharedWithMe.map((m: { id: string }) => m.id)).not.toContain(map.id);
    }
    const patch = await call(O, 'PATCH', `/maps/${map.id}`, { title: 'x', expectedRevision: 0 });
    expect(patch.statusCode).toBe(404);
  });
});
