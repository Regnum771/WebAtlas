import 'dotenv/config';
import { closePool, getPool } from '../db/pool';
import { buildRiverHierarchy } from '../db/riverHierarchy';
import { assertRiverGates, RIVER_BASELINE } from '../db/riverGates';

/**
 * VERIFY-AND-REPORT ONLY -- this script does NOT rebuild the live rivers version.
 *
 * buildRiverHierarchy is the single writer of the derived hierarchy (level-1 rivers,
 * the parent_external_id rewrite, flows_into_external_id), and it already ran once,
 * inside the ingest transaction, when the active `rivers` version was created (see
 * ingestRivers.ts). This wrapper re-runs the builder and the gates against the active
 * version inside a throwaway transaction, prints the counts, and ALWAYS rolls back, so a
 * human can read what the current code would produce without mutating anything.
 *
 * The builder is idempotent for any starting state (it clears the version's previous
 * derived output first -- see resetDerived in riverHierarchy.ts), so no reset is needed
 * here, and running it over an already-built version produces exactly what a fresh
 * ingest would. The rollback is policy, not necessity: ingest stays the only writer of a
 * committed hierarchy. To actually rebuild, delete the version and re-run
 * `npm run ingest:rivers -w @webatlas/api`. Do NOT turn this script into an in-place
 * rebuild.
 *
 * Usage: npm run rivers:hierarchy -w @webatlas/api
 */
async function main(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'rivers' AND is_active`
    );
    if (!rows[0]) {
      throw new Error('no active rivers version found');
    }
    const versionId = rows[0].id;

    const started = Date.now();
    const built = await buildRiverHierarchy(client, versionId);
    await assertRiverGates(client, versionId, RIVER_BASELINE);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    console.log(`version ${versionId}`);
    console.log(
      `  ${built.rivers} rivers from ${built.names} names over ${built.matched} named reaches` +
        ` (${built.bridged} bridged)`
    );
    console.log(`  gates passed in ${elapsed}s`);
    console.log('  ROLLBACK: this script only verifies -- re-run `npm run ingest:rivers` to rebuild');
  } finally {
    // A failed ROLLBACK (e.g. a dropped connection) must not skip releasing the client
    // or closing the pool, or the process hangs on the open handle.
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await closePool();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
