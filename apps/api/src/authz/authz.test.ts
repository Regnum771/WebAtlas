import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Grant } from '@webatlas/shared';
import { buildApp } from '../server';
import { getPool } from '../db/pool';
import { usersRepository } from '../modules/users/repository';
import { hashPassword } from '../lib/password';
import { ForbiddenError } from '../errors';
import type { CurrentUser } from '../types/fastify';
import { loadGrants } from './grants';
import { getUnitTree, invalidateUnitTree } from './unitTree';
import { assertCan, requireAdmin, requirePermission } from './assert';

const app = buildApp();
const PW = 'authz-pass-123';
const MULTI = 'authz-multi@webatlas.test'; // two groups
const REVOKE = 'authz-revoke@webatlas.test'; // one group, removed mid-test
const NONE = 'authz-none@webatlas.test'; // viewer without groups
const ADMIN = 'authz-admin@webatlas.test'; // admin without groups
const GROUP_PREFIX = 'authz-test-';

// Two real wards of province 48 (Đà Nẵng) in admin.unit_tree.
const WARD_A = '20194';
const WARD_B = '20200';

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
  return groupId;
}

async function cleanup() {
  await getPool().query(`DELETE FROM app.access_groups WHERE name LIKE $1`, [GROUP_PREFIX + '%']);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'authz-%@webatlas.test'`);
}

beforeAll(async () => {
  // Routes guarded only by the hooks under test. Registered as a child plugin so that
  // app.authenticate (decorated by the authentication plugin) exists when it runs.
  app.register(async (child) => {
    child.get('/api/__authz/update', { preHandler: [child.authenticate, requirePermission('feature.update')] }, async () => ({ ok: true }));
    child.get('/api/__authz/review-or-import', {
      preHandler: [child.authenticate, requirePermission('submission.review', 'map.import')],
    }, async () => ({ ok: true }));
    child.get('/api/__authz/admin', { preHandler: [child.authenticate, requireAdmin()] }, async () => ({ ok: true }));
    // Without app.authenticate: the hooks themselves must refuse an anonymous request.
    child.get('/api/__authz/bare', { preHandler: [requirePermission('feature.update')] }, async () => ({ ok: true }));
    child.get('/api/__authz/bare-admin', { preHandler: [requireAdmin()] }, async () => ({ ok: true }));
  });
  await app.ready();
  await cleanup();
  const repo = usersRepository(getPool());
  for (const [email, role] of [[MULTI, 'viewer'], [REVOKE, 'viewer'], [NONE, 'viewer'], [ADMIN, 'admin']] as const) {
    const row = await repo.insert({ email, password_hash: await hashPassword(PW), full_name: email, role });
    ids.set(email, row.id);
  }
  await createGroup('province', ['48'], ['feature.update'], [MULTI]);
  await createGroup('wards', [WARD_A, WARD_B], ['feature.create', 'map.import', 'feature.update'], [MULTI]);
  await createGroup('revoke', ['48'], ['feature.update'], [REVOKE]);
});
afterAll(async () => {
  await cleanup();
  await app.close();
});

const byKey = (a: Grant, b: Grant) => `${a.permission}|${a.unit}`.localeCompare(`${b.permission}|${b.unit}`);

describe('loadGrants', () => {
  it('loads the union of grants across groups', async () => {
    const grants = await loadGrants(getPool(), ids.get(MULTI)!);
    expect([...grants].sort(byKey)).toEqual(
      [
        { permission: 'feature.create', unit: WARD_A },
        { permission: 'feature.create', unit: WARD_B },
        { permission: 'feature.update', unit: '48' },
        { permission: 'feature.update', unit: WARD_A },
        { permission: 'feature.update', unit: WARD_B },
        { permission: 'map.import', unit: WARD_A },
        { permission: 'map.import', unit: WARD_B },
      ].sort((a, b) => byKey(a as Grant, b as Grant))
    );
  });
  it('returns no grants for a user without groups', async () => {
    expect(await loadGrants(getPool(), ids.get(NONE)!)).toEqual([]);
  });
  it('is distinct when two groups grant the same pair', async () => {
    await createGroup('dup', ['48'], ['feature.update'], [MULTI]);
    try {
      const grants = await loadGrants(getPool(), ids.get(MULTI)!);
      expect(grants.filter((g) => g.permission === 'feature.update' && g.unit === '48')).toHaveLength(1);
    } finally {
      await getPool().query(`DELETE FROM app.access_groups WHERE name = $1`, [GROUP_PREFIX + 'dup']);
    }
  });
});

describe('grants per request', () => {
  it('login returns grants and isAdmin', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN, password: PW } });
    expect(res.statusCode).toBe(200);
    tokens.set(ADMIN, res.json().token);
    expect(res.json().user.isAdmin).toBe(true);
    expect(res.json().user.grants).toEqual([]);

    const viewer = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: MULTI, password: PW } });
    expect(viewer.statusCode).toBe(200);
    tokens.set(MULTI, viewer.json().token);
    expect(viewer.json().user.isAdmin).toBe(false);
    expect(viewer.json().user.grants).toContainEqual({ permission: 'feature.update', unit: '48' });
    expect(viewer.json().user.password_hash).toBeUndefined();
  });

  it('never puts grants in the JWT', async () => {
    const token = await tokenFor(MULTI);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.grants).toBeUndefined();
    expect(payload.isAdmin).toBeUndefined();
  });

  it('drops a revoked grant on the next request', async () => {
    const headers = await auth(REVOKE);
    const before = await app.inject({ method: 'GET', url: '/api/auth/me', headers });
    expect(before.statusCode).toBe(200);
    expect(before.json().user.isAdmin).toBe(false);
    expect(before.json().user.grants).toContainEqual({ permission: 'feature.update', unit: '48' });

    await getPool().query(`DELETE FROM app.user_groups WHERE user_id = $1`, [ids.get(REVOKE)]);

    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers });
    expect(after.statusCode).toBe(200);
    expect(after.json().user.grants).toEqual([]);
  });
});

describe('requirePermission / requireAdmin', () => {
  it('admin passes requirePermission with no groups', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__authz/update', headers: await auth(ADMIN) });
    expect(res.statusCode).toBe(200);
  });
  it('passes a user holding the permission on some unit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__authz/update', headers: await auth(MULTI) });
    expect(res.statusCode).toBe(200);
  });
  it('passes when the user holds any one of several permissions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__authz/review-or-import', headers: await auth(MULTI) });
    expect(res.statusCode).toBe(200);
  });
  it('refuses a user holding the permission nowhere with NO_PERMISSION', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__authz/update', headers: await auth(NONE) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({
      code: 'NO_PERMISSION',
      message: 'Anh/chị chưa có quyền sửa đối tượng ở đơn vị nào.',
    });
  });
  it('names the first requested permission when none is held', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__authz/review-or-import', headers: await auth(NONE) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('Anh/chị chưa có quyền duyệt và xuất bản ở đơn vị nào.');
  });
  it('answers 401 without a user', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/__authz/update' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/__authz/bare' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/__authz/bare-admin' })).statusCode).toBe(401);
  });
  it('requireAdmin passes admin and refuses everyone else', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/__authz/admin', headers: await auth(ADMIN) })).statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/__authz/admin', headers: await auth(MULTI) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});

describe('getUnitTree', () => {
  it('loads the whole tree from admin.unit_tree', async () => {
    invalidateUnitTree();
    const tree = await getUnitTree(getPool());
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM admin.unit_tree`);
    expect(tree.size).toBe(rows[0].n);
    expect(tree.get('VN')).toEqual({ code: 'VN', level: 'country', parent: null, name: 'Toàn quốc' });
    expect(tree.get(WARD_A)?.parent).toBe('48');
  });
  it('caches per process for 10 minutes and reloads after invalidation', async () => {
    invalidateUnitTree();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const first = await getUnitTree(getPool());
      clock.mockReturnValue(now + 10 * 60_000 - 1);
      expect(await getUnitTree(getPool())).toBe(first);
      clock.mockReturnValue(now + 10 * 60_000 + 1);
      const reloaded = await getUnitTree(getPool());
      expect(reloaded).not.toBe(first);
      expect(await getUnitTree(getPool())).toBe(reloaded);
      invalidateUnitTree();
      expect(await getUnitTree(getPool())).not.toBe(reloaded);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('assertCan', () => {
  const user = (grants: Grant[], role: CurrentUser['role'] = 'viewer'): CurrentUser => ({
    id: '00000000-0000-0000-0000-000000000000',
    email: 'authz-unit@webatlas.test',
    role,
    isAdmin: role === 'admin',
    grants,
  });
  function caught(fn: () => void): ForbiddenError {
    try {
      fn();
    } catch (e) {
      return e as ForbiddenError;
    }
    throw new Error('expected assertCan to throw');
  }

  it('assertCan message names both units', async () => {
    const tree = await getUnitTree(getPool());
    const { rows } = await getPool().query(`SELECT code, name FROM admin.unit_tree WHERE code = ANY($1)`, [[WARD_A, WARD_B]]);
    const name = Object.fromEntries(rows.map((r: { code: string; name: string }) => [r.code, r.name]));
    const err = caught(() => assertCan(user([{ permission: 'feature.update', unit: WARD_A }]), 'feature.update', WARD_B, tree));
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('OUT_OF_JURISDICTION');
    expect(err.message).toBe(`Đối tượng thuộc ${name[WARD_B]}; nhóm của anh/chị chỉ có quyền trong ${name[WARD_A]}.`);
    expect(err.details).toEqual({ unit: WARD_B, permission: 'feature.update', allowed: [WARD_A] });
  });
  it('joins several allowed units with ", "', async () => {
    const tree = await getUnitTree(getPool());
    const grants: Grant[] = [
      { permission: 'feature.delete', unit: WARD_B },
      { permission: 'feature.delete', unit: WARD_A },
      { permission: 'feature.update', unit: '48' }, // another permission: not listed
    ];
    const err = caught(() => assertCan(user(grants), 'feature.delete', '01', tree));
    expect(err.code).toBe('OUT_OF_JURISDICTION');
    expect(err.message).toBe(
      `Đối tượng thuộc ${tree.get('01')!.name}; nhóm của anh/chị chỉ có quyền trong ${tree.get(WARD_A)!.name}, ${tree.get(WARD_B)!.name}.`
    );
  });
  it('throws NO_PERMISSION when the permission is held on no unit at all', async () => {
    const tree = await getUnitTree(getPool());
    const err = caught(() => assertCan(user([{ permission: 'feature.update', unit: '48' }]), 'submission.review', WARD_A, tree));
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.code).toBe('NO_PERMISSION');
    expect(err.message).toBe('Anh/chị chưa có quyền duyệt và xuất bản ở đơn vị nào.');
  });
  it('passes for a unit below a granted one', async () => {
    const tree = await getUnitTree(getPool());
    expect(() => assertCan(user([{ permission: 'feature.update', unit: '48' }]), 'feature.update', WARD_A, tree)).not.toThrow();
    expect(() => assertCan(user([{ permission: 'feature.update', unit: 'VN' }]), 'feature.update', '01', tree)).not.toThrow();
  });
  it('refuses a unit above a granted one', async () => {
    const tree = await getUnitTree(getPool());
    const err = caught(() => assertCan(user([{ permission: 'feature.update', unit: WARD_A }]), 'feature.update', '48', tree));
    expect(err.code).toBe('OUT_OF_JURISDICTION');
  });
  it('is a no-op for admin', async () => {
    const tree = await getUnitTree(getPool());
    expect(() => assertCan(user([], 'admin'), 'users.manage', WARD_A, tree)).not.toThrow();
  });
});
