import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from './repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const ADMIN = 'users-admin@webatlas.test';
const EDITOR = 'users-editor@webatlas.test';
const PW = 'admin-pass-123';
const created: string[] = [];

async function tokenFor(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PW } });
  return res.json().token as string;
}

beforeAll(async () => {
  await app.ready();
  const repo = usersRepository(getPool());
  for (const [email, role] of [[ADMIN, 'admin'], [EDITOR, 'editor']] as const) {
    if (!(await repo.findByEmailWithHash(email))) {
      await repo.insert({ email, password_hash: await hashPassword(PW), full_name: role, role });
    }
  }
});
afterAll(async () => {
  await getPool().query(`DELETE FROM app.users WHERE email LIKE '%@webatlas.test'`);
  await app.close();
});

describe('users CRUD (admin only)', () => {
  it('rejects non-admin with 403 and anonymous with 401', async () => {
    const editorToken = await tokenFor(EDITOR);
    const forbidden = await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: `Bearer ${editorToken}` } });
    expect(forbidden.statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: '/api/users' });
    expect(anon.statusCode).toBe(401);
  });

  it('admin creates (hashed), lists, updates, deletes; audit rows written', async () => {
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };
    const newEmail = 'created-user@webatlas.test';

    const create = await app.inject({ method: 'POST', url: '/api/users', headers: auth, payload: { email: newEmail, password: 'new-pass-123', role: 'editor' } });
    expect(create.statusCode).toBe(201);
    const id = create.json().user.id;
    created.push(id);
    expect(create.json().user.password_hash).toBeUndefined();

    // password stored hashed, not plaintext
    const { rows } = await getPool().query('SELECT password_hash FROM app.users WHERE id = $1', [id]);
    expect(rows[0].password_hash).not.toBe('new-pass-123');

    const dup = await app.inject({ method: 'POST', url: '/api/users', headers: auth, payload: { email: newEmail, password: 'x2345678', role: 'viewer' } });
    expect(dup.statusCode).toBe(409);

    const list = await app.inject({ method: 'GET', url: '/api/users', headers: auth });
    expect(list.json().users.some((u: { id: string }) => u.id === id)).toBe(true);

    const upd = await app.inject({ method: 'PUT', url: `/api/users/${id}`, headers: auth, payload: { role: 'admin', is_active: false } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().user.role).toBe('admin');

    const del = await app.inject({ method: 'DELETE', url: `/api/users/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);

    const audit = await getPool().query(`SELECT action FROM app.audit_log WHERE table_name = 'app.users' AND feature_id = $1 ORDER BY created_at`, [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['create', 'update', 'delete']);
  });
});
