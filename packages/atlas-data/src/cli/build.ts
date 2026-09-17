import pg from 'pg';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { runBuild } from '../runner';
import { parseBuildArgs } from './args';
import { selectDatasets, type ExclusionReason } from './select';

async function main(): Promise<void> {
  validateRegistry();

  // Argument and id errors are usage mistakes, not crashes: report just the message
  // (no stack) and exit before the pool is ever created, so a typo can never fall
  // through to "build everything" against a real database.
  let datasets = ALL_DATASETS;
  let excluded: ExclusionReason[] = [];
  try {
    const { only, except } = parseBuildArgs(process.argv.slice(2));
    ({ selected: datasets, excluded } = selectDatasets(ALL_DATASETS, { only, except }));
    if (datasets.length === 0) {
      throw new Error('atlas:build: no datasets selected (--only/--except excluded everything)');
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  // I2: say what was excluded and why, before the build summary — an empty --only/--except
  // combination must never be able to look, silently, like "nothing to do".
  for (const e of excluded) console.log(`  excluded ${e.id} (${e.reason})`);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });

  try {
    const report = await runBuild(pool, datasets);
    console.log(`executed ${report.executed.length}, skipped ${report.skipped.length}`);
    for (const s of report.executed) console.log(`  built   ${s}`);
    // D2 deviation from the brief: BuildReport now carries `errors` (label -> message)
    // and `blocked` may hold either a failed dataset's dependents or the later stages of
    // a dataset whose earlier stage failed. Print the message and say "(not run)" instead
    // of guessing "upstream failed", which is wrong for the same-dataset case.
    for (const s of report.failed) console.log(`  FAILED  ${s}: ${report.errors[s]}`);
    for (const s of report.blocked) console.log(`  blocked ${s} (not run)`);
    if (report.failed.length > 0 || report.blocked.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
