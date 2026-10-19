import type { Pool, PoolClient } from 'pg';
import { can, isWithin, unitsFor, type Permission, type UnitTree } from '@webatlas/shared';
import { accessGroupsRepository, type AccessGroup, type GroupRef } from './repository';
import { auditService } from '../audit/service';
import { getUnitTree } from '../../authz/unitTree';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import type { CurrentUser } from '../../types/fastify';

const GROUPS_TABLE = 'app.access_groups';
const MEMBERSHIP_TABLE = 'app.user_groups';

const dedupe = <T extends string>(xs: readonly T[]): T[] => [...new Set(xs)].sort();

async function inTransaction<T>(pg: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

async function assertUnitsExist(pg: Pool, units: string[]): Promise<void> {
  const tree = await getUnitTree(pg);
  const unknown = units.filter((u) => !tree.has(u));
  if (unknown.length > 0) {
    throw new ValidationError(`Mã đơn vị không có trong cây đơn vị: ${unknown.join(', ')}.`, { units: unknown });
  }
}

/**
 * The no-escalation rule for a users.manage holder: a group may be added to or removed from a
 * user only if every unit of the group lies within the holder's users.manage jurisdiction and
 * the holder holds each of the group's permissions on each of its units.
 */
export function canHandOver(holder: CurrentUser, group: Pick<AccessGroup, 'units' | 'permissions'>, tree: UnitTree): boolean {
  if (holder.isAdmin) return true;
  const scope = unitsFor(holder.grants, 'users.manage');
  if (group.units.length === 0) return false;
  return group.units.every(
    (unit) => isWithin(unit, scope, tree) && group.permissions.every((p) => can(holder.grants, p, unit, tree))
  );
}

export function accessGroupsService(pg: Pool) {
  const repo = accessGroupsRepository(pg);
  const audit = auditService(pg);
  return {
    list: () => repo.list(),

    async members(id: string) {
      if (!(await repo.findById(id))) throw new NotFoundError('Group not found');
      return repo.members(id);
    },

    async create(
      input: { name: string; description?: string; units: string[]; permissions: Permission[] },
      actorId?: string
    ): Promise<AccessGroup> {
      const units = dedupe(input.units);
      const permissions = dedupe(input.permissions);
      await assertUnitsExist(pg, units);
      try {
        return await inTransaction(pg, async (client) => {
          const id = await repo.insert({ name: input.name, description: input.description ?? null, createdBy: actorId ?? null }, client);
          await repo.replaceUnits(id, units, client);
          await repo.replacePermissions(id, permissions, client);
          const group = (await repo.findById(id, client))!;
          await audit.record({ userId: actorId, action: 'create', tableName: GROUPS_TABLE, featureId: id, after: group }, client);
          return group;
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictError('Tên nhóm đã được dùng.');
        throw err;
      }
    },

    async update(
      id: string,
      patch: { name?: string; description?: string | null; units?: string[]; permissions?: Permission[] },
      actorId?: string
    ): Promise<AccessGroup> {
      const units = patch.units ? dedupe(patch.units) : undefined;
      const permissions = patch.permissions ? dedupe(patch.permissions) : undefined;
      if (units) await assertUnitsExist(pg, units);
      try {
        return await inTransaction(pg, async (client) => {
          if (!(await repo.lockForUpdate(id, client))) throw new NotFoundError('Group not found');
          const before = (await repo.findById(id, client))!;
          await repo.updateFields(id, { name: patch.name, description: patch.description }, client);
          if (units) await repo.replaceUnits(id, units, client);
          if (permissions) await repo.replacePermissions(id, permissions, client);
          const after = (await repo.findById(id, client))!;
          await audit.record({ userId: actorId, action: 'update', tableName: GROUPS_TABLE, featureId: id, before, after }, client);
          return after;
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictError('Tên nhóm đã được dùng.');
        throw err;
      }
    },

    async remove(id: string, actorId?: string): Promise<void> {
      await inTransaction(pg, async (client) => {
        if (!(await repo.lockForUpdate(id, client))) throw new NotFoundError('Group not found');
        const before = (await repo.findById(id, client))!;
        const memberIds = (await repo.members(id, client)).map((m) => m.id);
        await repo.remove(id, client);
        await audit.record(
          { userId: actorId, action: 'delete', tableName: GROUPS_TABLE, featureId: id, before: { ...before, memberIds } },
          client
        );
      });
    },

    /**
     * Replaces the user's memberships with `groupIds`. A non-admin holder must pass the
     * no-escalation rule for every group added or removed; groups left as they are need not.
     */
    async setUserGroups(userId: string, groupIds: string[], holder: CurrentUser): Promise<GroupRef[]> {
      const wanted = dedupe(groupIds);
      const tree = await getUnitTree(pg);
      return inTransaction(pg, async (client) => {
        // Serialises concurrent membership changes of the same user.
        const { rows } = await client.query(`SELECT id FROM app.users WHERE id = $1 FOR UPDATE`, [userId]);
        if (rows.length === 0) throw new NotFoundError('User not found');

        const current = await repo.groupIdsOf(userId, client);
        const added = wanted.filter((g) => !current.includes(g));
        const removed = current.filter((g) => !wanted.includes(g));
        const changed = [...added, ...removed];
        if (changed.length === 0) return repo.groupsOf(userId, client);

        await repo.lockShared(changed, client);
        const groups = await repo.findMany(changed, client);
        const found = new Set(groups.map((g) => g.id));
        const unknown = added.filter((g) => !found.has(g));
        if (unknown.length > 0) {
          throw new ValidationError(`Không tìm thấy nhóm: ${unknown.join(', ')}.`, { groupIds: unknown });
        }

        const refused = groups.filter((g) => !canHandOver(holder, g, tree));
        if (refused.length > 0) {
          throw new ForbiddenError(
            `Anh/chị không thể gán hoặc gỡ nhóm ${refused.map((g) => `"${g.name}"`).join(', ')}: ` +
              'nhóm có đơn vị hoặc quyền vượt quá quyền của anh/chị.',
            'ESCALATION',
            { groupIds: refused.map((g) => g.id) }
          );
        }

        if (removed.length > 0) await repo.removeMemberships(userId, removed, client);
        if (added.length > 0) await repo.addMemberships(userId, added, client);
        await audit.record(
          { userId: holder.id, action: 'update', tableName: MEMBERSHIP_TABLE, featureId: userId, before: current, after: wanted },
          client
        );
        return repo.groupsOf(userId, client);
      });
    },
  };
}
