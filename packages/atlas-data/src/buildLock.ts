import type { Pool } from 'pg';

/** One key per database, shared by every command that writes build state. */
const LOCK_KEY = 'atlas-data:build';

/** Another build holds the lock. A usage situation, not a crash: commands print the message alone. */
export class BuildLockedError extends Error {}

/**
 * Run `fn` as the only build against this database. Two builds at once would run the same stages
 * twice and overwrite each other's state rows; nothing else stops them.
 *
 * A session-level advisory lock on a connection of its own, held for as long as `fn` runs:
 * PostgreSQL drops it when that connection closes, so a killed build leaves nothing to clean up.
 * Not waited for: a build can take an hour, and a second one started by mistake should say so now.
 */
export async function withBuildLock<T>(pool: Pool, command: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      [LOCK_KEY]
    );
    if (!rows[0].locked) {
      throw new BuildLockedError(
        `${command}: another atlas build is running against this database. Wait for it to finish, then run this again ` +
          '(npm run atlas:status shows what it has built so far).'
      );
    }
    try {
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}
