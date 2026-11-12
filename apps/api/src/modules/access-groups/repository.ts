import type { Pool } from 'pg';
import type { Permission } from '@webatlas/shared';

type Queryable = Pick<Pool, 'query'>;

export interface AccessGroup {
  id: string;
  name: string;
  description: string | null;
  units: string[];
  permissions: Permission[];
  memberCount: number;
}
export interface GroupMember { id: string; email: string; full_name: string | null }
export interface GroupRef { id: string; name: string }

const GROUP_SELECT = `
  SELECT g.id, g.name, g.description,
         COALESCE((SELECT array_agg(u.unit_code ORDER BY u.unit_code)
                     FROM app.access_group_units u WHERE u.group_id = g.id), '{}') AS units,
         COALESCE((SELECT array_agg(p.permission ORDER BY p.permission)
                     FROM app.access_group_permissions p WHERE p.group_id = g.id), '{}') AS permissions,
         (SELECT count(*)::int FROM app.user_groups ug WHERE ug.group_id = g.id) AS "memberCount"
    FROM app.access_groups g`;

export function accessGroupsRepository(pg: Pool) {
  return {
    async list(db: Queryable = pg): Promise<AccessGroup[]> {
      const { rows } = await db.query(`${GROUP_SELECT} ORDER BY g.name`);
      return rows;
    },
    async findById(id: string, db: Queryable = pg): Promise<AccessGroup | null> {
      const { rows } = await db.query(`${GROUP_SELECT} WHERE g.id = $1`, [id]);
      return rows[0] ?? null;
    },
    async findMany(ids: string[], db: Queryable = pg): Promise<AccessGroup[]> {
      const { rows } = await db.query(`${GROUP_SELECT} WHERE g.id = ANY($1::uuid[]) ORDER BY g.name`, [ids]);
      return rows;
    },
    /** Row locks: a group's definition cannot change while a membership check reads it. */
    async lockShared(ids: string[], db: Queryable): Promise<void> {
      await db.query(`SELECT id FROM app.access_groups WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE`, [ids]);
    },
    async lockForUpdate(id: string, db: Queryable): Promise<boolean> {
      const { rows } = await db.query(`SELECT id FROM app.access_groups WHERE id = $1 FOR UPDATE`, [id]);
      return rows.length > 0;
    },
    async insert(g: { name: string; description: string | null; createdBy: string | null }, db: Queryable): Promise<string> {
      const { rows } = await db.query(
        `INSERT INTO app.access_groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [g.name, g.description, g.createdBy]
      );
      return rows[0].id;
    },
    async updateFields(id: string, patch: { name?: string; description?: string | null }, db: Queryable): Promise<void> {
      const sets: string[] = []; const vals: unknown[] = []; let i = 1;
      if (patch.name !== undefined) { sets.push(`name = $${i++}`); vals.push(patch.name); }
      if (patch.description !== undefined) { sets.push(`description = $${i++}`); vals.push(patch.description); }
      sets.push('updated_at = now()');
      vals.push(id);
      await db.query(`UPDATE app.access_groups SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    },
    async replaceUnits(id: string, units: string[], db: Queryable): Promise<void> {
      await db.query(`DELETE FROM app.access_group_units WHERE group_id = $1`, [id]);
      await db.query(
        `INSERT INTO app.access_group_units (group_id, unit_code) SELECT $1, unnest($2::text[])`,
        [id, units]
      );
    },
    async replacePermissions(id: string, permissions: Permission[], db: Queryable): Promise<void> {
      await db.query(`DELETE FROM app.access_group_permissions WHERE group_id = $1`, [id]);
      await db.query(
        `INSERT INTO app.access_group_permissions (group_id, permission) SELECT $1, unnest($2::text[])`,
        [id, permissions]
      );
    },
    /** Memberships, units and permissions go with it (ON DELETE CASCADE). */
    async remove(id: string, db: Queryable): Promise<void> {
      await db.query(`DELETE FROM app.access_groups WHERE id = $1`, [id]);
    },
    async members(id: string, db: Queryable = pg): Promise<GroupMember[]> {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.full_name
           FROM app.user_groups ug JOIN app.users u ON u.id = ug.user_id
          WHERE ug.group_id = $1
          ORDER BY u.email`,
        [id]
      );
      return rows;
    },
    async groupIdsOf(userId: string, db: Queryable = pg): Promise<string[]> {
      const { rows } = await db.query(
        `SELECT group_id FROM app.user_groups WHERE user_id = $1 ORDER BY group_id`,
        [userId]
      );
      return rows.map((r: { group_id: string }) => r.group_id);
    },
    async groupsOf(userId: string, db: Queryable = pg): Promise<GroupRef[]> {
      const { rows } = await db.query(
        `SELECT g.id, g.name FROM app.user_groups ug JOIN app.access_groups g ON g.id = ug.group_id
          WHERE ug.user_id = $1 ORDER BY g.name`,
        [userId]
      );
      return rows;
    },
    async removeMemberships(userId: string, groupIds: string[], db: Queryable): Promise<void> {
      await db.query(`DELETE FROM app.user_groups WHERE user_id = $1 AND group_id = ANY($2::uuid[])`, [userId, groupIds]);
    },
    async addMemberships(userId: string, groupIds: string[], db: Queryable): Promise<void> {
      await db.query(
        `INSERT INTO app.user_groups (user_id, group_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [userId, groupIds]
      );
    },
  };
}
export type AccessGroupsRepository = ReturnType<typeof accessGroupsRepository>;
