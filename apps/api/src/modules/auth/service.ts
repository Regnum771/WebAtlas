import type { FastifyInstance } from 'fastify';
import { usersRepository, type UserRow } from '../users/repository';
import { verifyPassword } from '../../lib/password';
import { AuthError } from '../../errors';

export async function login(app: FastifyInstance, email: string, password: string): Promise<{ token: string; user: UserRow }> {
  const row = await usersRepository(app.pg).findByEmailWithHash(email);
  if (!row || !row.is_active) throw new AuthError('Invalid credentials');
  const ok = await verifyPassword(row.password_hash, password);
  if (!ok) throw new AuthError('Invalid credentials');
  const { password_hash, ...user } = row;
  const token = app.jwt.sign({ sub: user.id, role: user.role });
  return { token, user };
}
