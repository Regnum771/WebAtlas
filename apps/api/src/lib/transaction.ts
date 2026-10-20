import type { Pool, PoolClient } from 'pg';

/** Run `fn` on a client in its own transaction; roll back and rethrow on any error. */
export async function inTransaction<T>(pg: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pg.connect();
  // Set when ROLLBACK itself fails: the connection is then in an unknown state, and releasing
  // it with the error makes the pool destroy it instead of reusing it.
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    // Also safe after a failed COMMIT: the transaction is already over and this is a no-op.
    try { await client.query('ROLLBACK'); } catch (rollbackError) { broken = rollbackError as Error; }
    throw e;
  } finally {
    client.release(broken);
  }
}
