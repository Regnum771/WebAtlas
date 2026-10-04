import pg from 'pg';
import { loadDevEnv } from './env';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { runBuild } from '../runner';
import { printBuildReport } from './report';
import { parseBuildArgs } from './args';
import { applyCompose } from './composeFlag';
import { BuildLockedError, withBuildLock } from '../buildLock';
import { selectDatasets, assertForceSelected, assertSupersedeSelected, type ExclusionReason } from './select';

async function main(): Promise<void> {
  const envFile = loadDevEnv();
  if (envFile) console.log(`(environment from ${envFile})`);
  validateRegistry();

  // Argument and id errors are usage mistakes, not crashes: report just the message
  // (no stack) and exit before the pool is ever created, so a typo can never fall
  // through to "build everything" against a real database.
  let datasets = ALL_DATASETS;
  let excluded: ExclusionReason[] = [];
  let force: string[] = [];
  let supersedeEdits: string[] = [];
  try {
    const { only, except, force: forced, supersedeEdits: superseded } = parseBuildArgs(applyCompose(process.argv.slice(2), 'atlas:build').rest);
    ({ selected: datasets, excluded } = selectDatasets(ALL_DATASETS, { only, except }));
    if (datasets.length === 0) {
      throw new Error('atlas:build: no datasets selected (--only/--except excluded everything)');
    }
    assertForceSelected(forced, ALL_DATASETS, datasets);
    force = forced;
    assertSupersedeSelected(superseded, ALL_DATASETS, datasets);
    supersedeEdits = superseded;
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
  // keepAlive: the build lock's connection sits idle for the whole build (buildLock.ts).
  const pool = new pg.Pool({ connectionString, keepAlive: true });

  try {
    const report = await withBuildLock(pool, 'atlas:build', () =>
      runBuild(pool, datasets, { universe: ALL_DATASETS, force, supersedeEdits })
    );
    printBuildReport(report);
  } catch (err) {
    if (!(err instanceof BuildLockedError)) throw err;
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
