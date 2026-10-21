import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { mapRole, sharedWithUserSql } from './access';

afterAll(async () => {
  await closePool();
});

/**
 * workspace.map_role (migration 30) is the one definition of who may see a map; mapRole calls it,
 * and the worker re-checks it before an export. The "shared with me" list still uses
 * sharedWithUserSql as a join-friendly predicate, so this also checks that the list's predicate
 * agrees with the function. Everything runs in one transaction that is rolled back.
 */
describe('workspace.map_role', () => {
  it('answers like mapRole and the shared-with-me predicate for every kind of user', async () => {
    const c = await getPool().connect();
    try {
      await c.query('BEGIN');
      const user = async (who: string) =>
        (await c.query<{ id: string }>(
          `INSERT INTO app.users (email, password_hash, role) VALUES ($1, 'x', 'viewer') RETURNING id::text AS id`,
          [`p3b-maprole-${who}@webatlas.test`]
        )).rows[0].id;
      const owner = await user('owner');
      const direct = await user('direct');
      const member = await user('member');
      const stranger = await user('stranger');
      const map = async (archived: boolean) =>
        (await c.query<{ id: string }>(
          `INSERT INTO workspace.maps (owner_id, title, archived_at)
           VALUES ($1, 'map_role', CASE WHEN $2::boolean THEN now() END) RETURNING id::text AS id`,
          [owner, archived]
        )).rows[0].id;
      const live = await map(false);
      const archived = await map(true);
      const { rows: g } = await c.query<{ id: string }>(
        `INSERT INTO app.access_groups (name) VALUES ('p3b-maprole-group') RETURNING id::text AS id`
      );
      await c.query(`INSERT INTO app.user_groups (user_id, group_id) VALUES ($1, $2)`, [member, g[0].id]);
      for (const m of [live, archived]) {
        await c.query(`INSERT INTO workspace.map_shares (map_id, user_id) VALUES ($1, $2)`, [m, direct]);
        await c.query(`INSERT INTO workspace.map_shares (map_id, group_id) VALUES ($1, $2)`, [m, g[0].id]);
      }

      const cases: Array<[string, string, string, string | null]> = [
        ['owner', live, owner, 'owner'],
        ['direct recipient', live, direct, 'recipient'],
        ['group recipient', live, member, 'recipient'],
        ['stranger', live, stranger, null],
        ['archived map, owner', archived, owner, null],
        ['archived map, direct recipient', archived, direct, null],
        ['archived map, group recipient', archived, member, null],
      ];
      for (const [name, mapId, userId, expected] of cases) {
        const { rows } = await c.query<{ role: string | null; listed: boolean }>(
          `SELECT workspace.map_role($1, $2) AS role,
                  (m.owner_id <> $2 AND m.archived_at IS NULL AND ${sharedWithUserSql('$2')}) AS listed
             FROM workspace.maps m WHERE m.id = $1`,
          [mapId, userId]
        );
        expect({ name, role: rows[0].role }).toEqual({ name, role: expected });
        expect({ name, role: await mapRole(c, mapId, userId) }).toEqual({ name, role: expected });
        expect({ name, listed: rows[0].listed }).toEqual({ name, listed: expected === 'recipient' });
      }
      // A map that does not exist is no one's.
      expect(await mapRole(c, '00000000-0000-0000-0000-000000000000', owner)).toBeNull();
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
