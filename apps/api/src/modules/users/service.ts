import type { Pool } from 'pg';
import { usersRepository, type UserRow, type Role } from './repository';
import { auditService } from '../audit/service';
import { hashPassword } from '../../lib/password';
import { ConflictError, NotFoundError } from '../../errors';

export function usersService(pg: Pool) {
  const repo = usersRepository(pg);
  const audit = auditService(pg);
  return {
    list: () => repo.list(),
    async create(input: { email: string; password: string; full_name?: string; role: Role }, actorId?: string): Promise<UserRow> {
      const existing = await repo.findByEmailWithHash(input.email);
      if (existing) throw new ConflictError('Email already in use');
      const user = await repo.insert({
        email: input.email, password_hash: await hashPassword(input.password),
        full_name: input.full_name ?? null, role: input.role,
      });
      await audit.record({ userId: actorId, action: 'create', tableName: 'app.users', featureId: user.id, after: user });
      return user;
    },
    async update(id: string, patch: { full_name?: string | null; role?: Role; is_active?: boolean }, actorId?: string): Promise<UserRow> {
      const before = await repo.findById(id);
      if (!before) throw new NotFoundError('User not found');
      const after = await repo.update(id, patch);
      await audit.record({ userId: actorId, action: 'update', tableName: 'app.users', featureId: id, before, after });
      return after!;
    },
    async remove(id: string, actorId?: string): Promise<void> {
      const before = await repo.findById(id);
      if (!before) throw new NotFoundError('User not found');
      await repo.remove(id);
      await audit.record({ userId: actorId, action: 'delete', tableName: 'app.users', featureId: id, before });
    },
  };
}
