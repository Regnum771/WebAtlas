import type { FastifyInstance } from 'fastify';
import { usersRepository, type UserRow } from '../users/repository';
import { verifyPassword } from '../../lib/password';
import { AuthError } from '../../errors';
import { loadGrants } from '../../authz/grants';
import type { Grant } from '@webatlas/shared';

export type LoginUser = UserRow & { isAdmin: boolean; grants: Grant[] };

export async function login(app: FastifyInstance, email: string, password: string): Promise<{ token: string; user: LoginUser }> {
  const row = await usersRepository(app.pg).findByEmailWithHash(email);
  if (!row || !row.is_active) throw new AuthError('Invalid credentials');
  const ok = await verifyPassword(row.password_hash, password);
  if (!ok) throw new AuthError('Invalid credentials');
  const { password_hash, ...user } = row;
  // The JWT carries identity only; grants are loaded per request (plugins/authentication).
  const token = app.jwt.sign({ sub: user.id, role: user.role });
  const grants = await loadGrants(app.pg, user.id);
  return { token, user: { ...user, isAdmin: user.role === 'admin', grants } };
}
