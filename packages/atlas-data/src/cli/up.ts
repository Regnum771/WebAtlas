import pg from 'pg';
import { loadDevEnv } from './env';
import { realSystem } from './system';
import { applyCompose } from './composeFlag';
import { printBuildReport } from './report';
import { parseBuildArgs } from './args';
import { selectDatasets, assertForceSelected, assertSupersedeSelected, type ExclusionReason } from './select';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { runBuild } from '../runner';
import { verifyAtlas, formatVerify } from '../verify';
import { probeContext } from '../probes';
import { geoserverEnv } from '../geoserver';
import { composeArgs, composeEnv, composeFile } from '../compose';
import { BuildLockedError, withBuildLock } from '../buildLock';
import { npmCli } from '../stages/run';
import { assertOwnStack, buildTools, closingLines, migrate, preflight, startStack, UpError, waitReady, type UpConfig } from '../up';
import { DATA_CACHE, REPO_ROOT } from '../paths';

async function main(): Promise<void> {
  validateRegistry();

  // Usage errors first, before anything starts.
  let datasets = ALL_DATASETS;
  let excluded: ExclusionReason[] = [];
  let force: string[] = [];
  let supersedeEdits: string[] = [];
  const argv = process.argv.slice(2);
  let compose: string | undefined;
  try {
    const taken = applyCompose(argv, 'atlas:up');
    compose = taken.compose;
    const rest = taken.rest;
    const { only, except, force: forced, supersedeEdits: superseded } = parseBuildArgs(rest);
    ({ selected: datasets, excluded } = selectDatasets(ALL_DATASETS, { only, except }));
    if (datasets.length === 0) throw new Error('atlas:up: no datasets selected (--only/--except excluded everything)');
    assertForceSelected(forced, ALL_DATASETS, datasets);
    force = forced;
    assertSupersedeSelected(superseded, ALL_DATASETS, datasets);
    supersedeEdits = superseded;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const sys = realSystem();
  const cfg: UpConfig = {
    repoRoot: REPO_ROOT,
    cacheDir: DATA_CACHE,
    nodeVersion: process.versions.node,
    docker: composeArgs(),
    composeFile: composeFile(),
    allowSharedStack: process.env.ATLAS_SHARED_STACK === '1',
    dockerEnv: composeEnv(),
    npm: { file: process.execPath, args: [npmCli()] },
  };

  try {
    console.log('== preflight');
    await preflight(sys, cfg);
    // After preflight: it may have just created apps/api/.env.
    const envFile = loadDevEnv();
    if (envFile) console.log(`(environment from ${envFile})`);
    cfg.dockerEnv = composeEnv();
    console.log('== stack');
    await assertOwnStack(sys, cfg);
    if (!process.env.DATABASE_URL) throw new UpError('DATABASE_URL is not set (apps/api/.env)');
    if (!process.env.GEOSERVER_URL) throw new UpError('GEOSERVER_URL is not set (apps/api/.env)');
    await startStack(sys, cfg);
    await waitReady(sys, cfg, geoserverEnv());
  } catch (err) {
    if (err instanceof UpError) {
      console.error(`atlas:up: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  for (const e of excluded) console.log(`  excluded ${e.id} (${e.reason})`);
  let failedRun = false;
  // keepAlive: the build lock's connection sits idle for the whole build (buildLock.ts).
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, keepAlive: true });
  try {
    // Locked from the first write on: a second atlas:up started by mistake must not migrate the
    // database under a build that is running.
    await withBuildLock(pool, 'atlas:up', async () => {
      console.log('== atlas-tools image');
      await buildTools(sys, cfg);
      console.log('== migrations');
      await migrate(sys, cfg);
      console.log('== build');
      printBuildReport(await runBuild(pool, datasets, { universe: ALL_DATASETS, force, supersedeEdits }));
      console.log('== verify');
      const { lines, ok } = formatVerify(await verifyAtlas(pool, datasets, probeContext(pool)));
      for (const line of lines) console.log(line);
      if (!ok) failedRun = true;
    });
  } catch (err) {
    if (err instanceof UpError) console.error(`atlas:up: ${err.message}`);
    else if (err instanceof BuildLockedError) console.error(err.message);
    else throw err;
    failedRun = true;
  } finally {
    await pool.end();
  }

  const ok = !failedRun && !process.exitCode;
  for (const line of closingLines({
    ok,
    argv,
    // The command for the whole atlas keeps --compose and drops the selection flags.
    composeArgv: compose ? ['--compose', compose] : [],
    selected: datasets.map((d) => d.id),
    all: ALL_DATASETS.map((d) => d.id),
  })) console.log(line);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
