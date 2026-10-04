import 'dotenv/config';
import { closePool, getPool } from '../db/pool';
import { assertRiverGates, buildRiverHierarchy, RIVER_BASELINE } from '@webatlas/versioning';

/**
 * VERIFY-AND-REPORT ONLY -- this script does NOT rebuild the live rivers version.
 *
 * buildRiverHierarchy is the single writer of the derived hierarchy (level-1 rivers, the
 * level-2/3 river links, flows_into between rivers), and versionsService.activate() runs
 * it -- plus the activation gates -- every time a `rivers` version becomes active. This
 * wrapper re-runs the builder and the gates against the active version inside a throwaway
 * transaction, prints the counts, and ALWAYS rolls back, so a human can read what the
 * current code would produce without mutating anything.
 *
 * The builder writes only differences, so on an unchanged network it reports 0 rows
 * superseded; a non-zero figure means the current code would change the committed
 * hierarchy. The rollback is policy, not necessity: activate() stays the only writer of
 * a committed hierarchy. To actually rebuild after changing the builder, raise
 * `mappingRevision` on the rivers load stage (packages/atlas-data/src/descriptors/rivers.ts)
 * and run `npm run atlas:build`: the same files then load as a new version, and activation
 * builds its hierarchy with the current code. Over steward edits that needs
 * `--supersede-edits rivers`. A forced build over an unchanged version only re-stamps it,
 * and a pin test in atlas-data fails when the builder changes without that decision being
 * made. Do NOT turn this script into an in-place rebuild.
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
    console.log(`  ${built.superseded} rows would change against the committed hierarchy`);
    console.log(`  gates passed in ${elapsed}s`);
    console.log('  ROLLBACK: this script only verifies -- to rebuild, see its header');
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
