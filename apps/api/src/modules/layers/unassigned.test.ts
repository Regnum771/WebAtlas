import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const PW = 'unassigned-pass-123';
const MINISTRY = 'unassigned-ministry@webatlas.test'; // feature.update on VN
const PROVINCE = 'unassigned-province@webatlas.test'; // feature.update on 48
const ADMIN = 'unassigned-admin@webatlas.test';
const GROUP_PREFIX = 'unassigned-test-';
const ids = new Map<string, string>();

// One login per user: /api/auth/login allows 10 per minute.
const tokens = new Map<string, string>();
async function auth(email: string) {
  let token = tokens.get(email);
  if (!token) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PW } });
    token = res.json().token as string;
    tokens.set(email, token);
  }
  return { authorization: `Bearer ${token}` };
}

async function createGroup(name: string, unit: string, permissions: string[], member: string) {
  const pg = getPool();
  const { rows } = await pg.query(`INSERT INTO app.access_groups (name) VALUES ($1) RETURNING id`, [GROUP_PREFIX + name]);
  const groupId = rows[0].id as string;
  await pg.query(`INSERT INTO app.access_group_units (group_id, unit_code) VALUES ($1, $2)`, [groupId, unit]);
  for (const p of permissions) {
    await pg.query(`INSERT INTO app.access_group_permissions (group_id, permission) VALUES ($1, $2)`, [groupId, p]);
  }
  await pg.query(`INSERT INTO app.user_groups (user_id, group_id) VALUES ($1, $2)`, [ids.get(member), groupId]);
}

async function cleanup() {
  await getPool().query(`DELETE FROM app.access_groups WHERE name LIKE $1`, [GROUP_PREFIX + '%']);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'unassigned-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanup();
  const repo = usersRepository(getPool());
  for (const [email, role] of [[MINISTRY, 'viewer'], [PROVINCE, 'viewer'], [ADMIN, 'admin']] as const) {
    const row = await repo.insert({ email, password_hash: await hashPassword(PW), full_name: email, role });
    ids.set(email, row.id);
  }
  await createGroup('ministry', 'VN', ['feature.update', 'submission.review'], MINISTRY);
  await createGroup('province', '48', ['feature.update', 'submission.review'], PROVINCE);
});

afterAll(async () => {
  await cleanup();
  await app.close();
});

const get = async (email?: string) =>
  app.inject({ method: 'GET', url: '/api/layers/unassigned', headers: email ? await auth(email) : {} });

describe('GET /api/layers/unassigned', () => {
  it('lists the dams without geometry', async () => {
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM water.dams_active WHERE geom IS NULL AND managing_unit = 'VN'`
    );
    const res = await get(ADMIN);
    expect(res.statusCode).toBe(200);
    const features = res.json().features as Array<{ layerKey: string; id: string; externalId: string; name: string | null }>;
    const dams = features.filter((f) => f.layerKey === 'dams');
    expect(dams.length).toBe(Number(rows[0].n));
    expect(dams.length).toBeGreaterThan(0);
    expect(typeof dams[0].externalId).toBe('string');
    expect(typeof dams[0].id).toBe('string');
    // Ordered by layerKey, then name.
    const keys = features.map((f) => f.layerKey);
    expect(keys).toEqual([...keys].sort());
  });

  it('is open to a ministry officer holding feature.update on VN', async () => {
    expect((await get(MINISTRY)).statusCode).toBe(200);
  });

  it('refuses a province officer', async () => {
    const res = await get(PROVINCE);
    expect(res.statusCode).toBe(403);
  });

  it('requires a signed-in user', async () => {
    expect((await get()).statusCode).toBe(401);
  });
});
