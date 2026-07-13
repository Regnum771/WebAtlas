import type { Pool } from 'pg';

export type Role = 'admin' | 'editor' | 'viewer';
export interface UserRow {
  id: string; email: string; full_name: string | null; role: Role;
  is_active: boolean; created_at: string; updated_at: string;
}
const COLS = 'id, email, full_name, role, is_active, created_at, updated_at';

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
    async list(): Promise<UserRow[]> {
      const { rows } = await pg.query(`SELECT ${COLS} FROM app.users ORDER BY created_at DESC`);
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
    async update(id: string, patch: { full_name?: string | null; role?: Role; is_active?: boolean }): Promise<UserRow | null> {
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
