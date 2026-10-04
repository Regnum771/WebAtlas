import type { Pool } from 'pg';

/**
 * The lock's key, in PostgreSQL's two-integer form: 'ATLS' and 1. That form shares no keys with
 * single-bigint advisory locks (apps/api's layers repository takes those, keyed by hashtext).
 */
const LOCK_CLASS = 0x41544c53;
const LOCK_ID = 1;

/** The build lock could not be taken, or was lost. A situation, not a crash: commands print the message alone. */
export class BuildLockedError extends Error {}

/**
 * Run `fn` as the only build against this database. Two builds at once would run the same stages
 * twice and overwrite each other's state rows; nothing else stops them.
 *
 * A session-level advisory lock on a connection of its own, held for as long as `fn` runs:
 * PostgreSQL drops it when that connection closes, so a killed build leaves nothing to clean up.
 * Not waited for: a build can take an hour, and a second one started by mistake should say so now.
 *
 * That connection is idle for the whole build. The pool should be created with `keepAlive: true`,
 * and if the connection is lost anyway the build is reported as having run unlocked: the error
 * is recorded instead of crashing the process mid-stage. The connection is closed afterwards, not
 * returned to the pool, so the lock is gone whether or not the unlock statement got through.
 */
export async function withBuildLock<T>(pool: Pool, command: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let lost: Error | undefined;
  // pg emits 'error' on a checked-out client whose connection ends; unhandled, it kills the process.
  client.on('error', (err: Error) => {
    lost = err;
  });
  let held = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1::int, $2::int) AS locked`,
      [LOCK_CLASS, LOCK_ID]
    );
    if (!rows[0].locked) {
      throw new BuildLockedError(
        `${command}: another atlas build is running against this database. Wait for it to finish, then run this again ` +
          '(npm run atlas:status shows what it has built so far).'
      );
    }
    held = true;
    const result = await fn();
    if (lost) {
      throw new BuildLockedError(
        `${command}: the connection holding the build lock was lost during the build (${lost.message}), so part of it ` +
          'ran unlocked. Check npm run atlas:status, then build again.'
      );
    }
    return result;
  } finally {
    if (held && !lost) await client.query(`SELECT pg_advisory_unlock($1::int, $2::int)`, [LOCK_CLASS, LOCK_ID]).catch(() => {});
    client.release(true);
  }
}
