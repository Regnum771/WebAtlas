import { resolve } from 'node:path';
import pg from 'pg';
import { loadDevEnv } from './env';
import { realSystem } from './system';
import { takeCompose } from './composeFlag';
import { printBuildReport } from './report';
import { parseBuildArgs } from './args';
import { selectDatasets, assertForceSelected, assertSupersedeSelected, type ExclusionReason } from './select';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { runBuild } from '../runner';
import { verifyAtlas, formatVerify } from '../verify';
import { probeContext } from '../probes';
import { geoserverEnv } from '../geoserver';
import { composeArgs, composeEnv } from '../compose';
import { npmCli } from '../stages/run';
import { buildTools, migrate, preflight, startStack, UpError, waitReady, type UpConfig } from '../up';
import { DATA_CACHE, REPO_ROOT } from '../paths';

async function main(): Promise<void> {
  validateRegistry();

  // Usage errors first, before anything starts.
  let datasets = ALL_DATASETS;
  let excluded: ExclusionReason[] = [];
  let force: string[] = [];
  let supersedeEdits: string[] = [];
  try {
    const { compose, rest } = takeCompose(process.argv.slice(2));
    if (compose) process.env.ATLAS_COMPOSE_FILE = resolve(process.env.INIT_CWD ?? process.cwd(), compose);
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
    if (!process.env.DATABASE_URL) throw new UpError('DATABASE_URL is not set (apps/api/.env)');
    if (!process.env.GEOSERVER_URL) throw new UpError('GEOSERVER_URL is not set (apps/api/.env)');
    await startStack(sys, cfg);
    await waitReady(sys, cfg, geoserverEnv());
    console.log('== atlas-tools image');
    await buildTools(sys, cfg);
    console.log('== migrations');
    await migrate(sys, cfg);
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
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log('== build');
    printBuildReport(await runBuild(pool, datasets, { universe: ALL_DATASETS, force, supersedeEdits }));
    console.log('== verify');
    const { lines, ok } = formatVerify(await verifyAtlas(pool, datasets, probeContext(pool)));
    for (const line of lines) console.log(line);
    if (!ok) failedRun = true;
  } finally {
    await pool.end();
  }

  if (failedRun || process.exitCode) {
    console.log('');
    console.log('atlas:up did not complete — fix the error above and run npm run atlas:up again (finished work is skipped)');
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log('next: create an administrator (there is no default login):');
  console.log('  npm run create-admin -w @webatlas/api -- --email you@example.com --password "…" --name "…"');
  console.log('then: npm run dev -w @webatlas/api   and   npm run dev:web');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
