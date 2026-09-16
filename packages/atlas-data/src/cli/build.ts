import pg from 'pg';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { withDependencies, withoutDependents } from '../graph';
import { runBuild } from '../runner';

function listArg(flag: string): string[] {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(',') : [];
}

async function main(): Promise<void> {
  validateRegistry();

  const only = listArg('--only');
  const except = listArg('--except');
  let datasets = ALL_DATASETS;
  if (only.length > 0) datasets = withDependencies(datasets, only);
  if (except.length > 0) datasets = withoutDependents(datasets, except);

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
