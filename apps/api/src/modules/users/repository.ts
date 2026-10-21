import type { Pool } from 'pg';

// The editor role is retired (P1); the database refuses it (users_role_not_editor).
export type Role = 'admin' | 'viewer';
export interface UserRow {
  id: string; email: string; full_name: string | null; role: Role;
  is_active: boolean; created_at: string; updated_at: string;
  /** app.users.quota_bytes (bigint) as a number: quotas stay far below 2^53. */
  quotaBytes: number;
}
export interface UserPatch { full_name?: string | null; role?: Role; is_active?: boolean; quota_bytes?: number }
// PLAIN columns can also be prefixed (u.<col>); quota_bytes is selected through QUOTA.
const PLAIN = 'id, email, full_name, role, is_active, created_at, updated_at';
const QUOTA = (prefix = '') => `${prefix}quota_bytes::float8 AS "quotaBytes"`;
const COLS = `${PLAIN}, ${QUOTA()}`;

export function usersRepository(pg: Pool) {
  return {
    async findByEmailWithHash(email: string): Promise<(UserRow & { password_hash: string }) | null> {
      const { rows } = await pg.query(`SELECT ${COLS}, password_hash FROM app.users WHERE email = $1`, [email]);
      return rows[0] ?? null;
    },
    async findById(id: string): Promise<UserRow | null> {
      const { rows } = await pg.query(`SELECT ${COLS} FROM app.users WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },
    /** Every user with the groups it belongs to. */
    async listWithGroups(): Promise<Array<UserRow & { groups: Array<{ id: string; name: string }> }>> {
      const { rows } = await pg.query(
        `SELECT ${PLAIN.split(', ').map((c) => `u.${c}`).join(', ')}, ${QUOTA('u.')},
                COALESCE((SELECT json_agg(json_build_object('id', g.id, 'name', g.name) ORDER BY g.name)
                            FROM app.user_groups ug JOIN app.access_groups g ON g.id = ug.group_id
                           WHERE ug.user_id = u.id), '[]'::json) AS groups
           FROM app.users u
          ORDER BY u.created_at DESC`
      );
      return rows;
    },
    async insert(u: { email: string; password_hash: string; full_name: string | null; role: Role }): Promise<UserRow> {
      const { rows } = await pg.query(
        `INSERT INTO app.users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
        [u.email, u.password_hash, u.full_name, u.role]
      );
      return rows[0];
    },
    async update(id: string, patch: UserPatch): Promise<UserRow | null> {
      const sets: string[] = []; const vals: unknown[] = []; let i = 1;
      for (const [k, v] of Object.entries(patch)) { if (v !== undefined) { sets.push(`${k} = $${i++}`); vals.push(v); } }
      if (sets.length === 0) return this.findById(id);
      sets.push(`updated_at = now()`);
      vals.push(id);
      const { rows } = await pg.query(`UPDATE app.users SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${COLS}`, vals);
      return rows[0] ?? null;
    },
    async remove(id: string): Promise<boolean> {
      const { rowCount } = await pg.query(`DELETE FROM app.users WHERE id = $1`, [id]);
      return (rowCount ?? 0) > 0;
    },
  };
}
export type UsersRepository = ReturnType<typeof usersRepository>;
