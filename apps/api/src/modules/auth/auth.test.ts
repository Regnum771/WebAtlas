import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const EMAIL = 'login-test@webatlas.test';
const PW = 'login-pass-123';

beforeAll(async () => {
  await app.ready();
  const repo = usersRepository(getPool());
  const existing = await repo.findByEmailWithHash(EMAIL);
  if (!existing) await repo.insert({ email: EMAIL, password_hash: await hashPassword(PW), full_name: 'Login Test', role: 'admin' });
});
afterAll(async () => {
  await getPool().query('DELETE FROM app.users WHERE email = $1', [EMAIL]);
  await app.close();
});

describe('auth', () => {
  it('logs in with valid credentials and returns a token + user (no hash)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: EMAIL, password: PW } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.password_hash).toBeUndefined();
  });
  it('rejects a wrong password with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: EMAIL, password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_ERROR');
  });
  it('GET /api/auth/me returns the current user with a token, 401 without', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: EMAIL, password: PW } });
    const token = login.json().token;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(EMAIL);
    const anon = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);
  });
});
