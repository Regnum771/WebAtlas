import type { Pool } from 'pg';
import type { Grant } from '@webatlas/shared';

/**
 * The user's grants: every (permission, unit) pair of every group the user belongs to.
 * Read from the database on each request (never from the JWT), so a revoked membership
 * takes effect on the very next request.
 */
export async function loadGrants(pg: Pool, userId: string): Promise<Grant[]> {
  const { rows } = await pg.query<Grant>(
    `SELECT DISTINCT p.permission, u.unit_code AS unit
       FROM app.user_groups ug
       JOIN app.access_group_permissions p ON p.group_id = ug.group_id
       JOIN app.access_group_units u ON u.group_id = ug.group_id
      WHERE ug.user_id = $1
      ORDER BY p.permission, unit`,
    [userId]
  );
  return rows;
}
