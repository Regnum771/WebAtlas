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
 * ingestRivers.ts). Level-1 rows for that version already exist. Running the builder
 * again here and COMMITting would try to INSERT the same 'river:<id>' external_ids a
 * second time and violate the (dataset_version_id, external_id) unique index -- so this
 * wrapper always ROLLBACKs. Its only job is to run the builder and the gates against the
 * live version inside a throwaway transaction, print the counts, and let a human read
 * them, without mutating anything.
 *
 * To actually rebuild the hierarchy (e.g. after changing the matching or grouping
 * logic), delete the version and re-run `npm run ingest:rivers -w @webatlas/api` --
 * ingest is the only writer. Do NOT "fix" this script into an in-place rebuild.
 *
 * The level-1 rows this transaction is about to insert already exist under the same
 * (dataset_version_id, external_id) from the real ingest run, so a bare second call to
 * buildRiverHierarchy would hit the unique index before printing anything. This wrapper
 * deletes ONLY this throwaway transaction's uncommitted view of the level-1 rows first --
 * safe precisely because the whole transaction is rolled back below, never committed, so
 * the real rows the live version depends on are untouched the moment this process exits.
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

    // See the doc comment: only safe because this whole transaction is rolled back below.
    await client.query(
      `DELETE FROM water.rivers WHERE dataset_version_id = $1 AND feature_level = 1`,
      [versionId]
    );

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
    await client.query('ROLLBACK');
    client.release();
    await closePool();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
