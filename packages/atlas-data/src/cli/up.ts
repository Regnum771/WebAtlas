import { resolve } from 'node:path';
import pg from 'pg';
import { loadDevEnv } from './env';
import { realSystem } from './system';
import { printBuildReport } from './report';
import { parseBuildArgs } from './args';
import { selectDatasets, assertForceSelected, type ExclusionReason } from './select';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { runBuild } from '../runner';
import { verifyAtlas, formatVerify } from '../verify';
import { probeContext } from '../probes';
import { geoserverEnv } from '../geoserver';
import { composeArgs, composeEnv } from '../compose';
import { npmCli } from '../stages/run';
import { buildTools, migrate, preflight, startStack, UpError, waitReady, type UpConfig } from '../up';
import { DATA_CACHE, REPO_ROOT } from '../paths';

/** `--compose <file>` or `--compose=<file>` is atlas:up's own; everything else is atlas:build's. */
function takeCompose(argv: string[]): { compose?: string; rest: string[] } {
  const rest: string[] = [];
  let compose: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compose') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error('atlas:up: --compose requires a file');
      compose = v;
      i++;
    } else if (a.startsWith('--compose=')) {
      compose = a.slice('--compose='.length);
    } else {
      rest.push(a);
    }
  }
  return { compose, rest };
}

async function main(): Promise<void> {
  validateRegistry();

  // Usage errors first, before anything starts.
  let datasets = ALL_DATASETS;
  let excluded: ExclusionReason[] = [];
  let force: string[] = [];
  try {
    const { compose, rest } = takeCompose(process.argv.slice(2));
    if (compose) process.env.ATLAS_COMPOSE_FILE = resolve(compose);
    const { only, except, force: forced } = parseBuildArgs(rest);
    ({ selected: datasets, excluded } = selectDatasets(ALL_DATASETS, { only, except }));
    if (datasets.length === 0) throw new Error('atlas:up: no datasets selected (--only/--except excluded everything)');
    assertForceSelected(forced, ALL_DATASETS, datasets);
    force = forced;
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
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });
  try {
    console.log('== build');
    printBuildReport(await runBuild(pool, datasets, { universe: ALL_DATASETS, force }));
    console.log('== verify');
    const { lines, ok } = formatVerify(await verifyAtlas(pool, datasets, probeContext(pool)));
    for (const line of lines) console.log(line);
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }

  console.log('');
  console.log('next: create an administrator (there is no default login):');
  console.log('  npm run create-admin -w @webatlas/api -- --email you@example.com --password "…" --name "…"');
  console.log('then: npm run dev -w @webatlas/api   and   npm run dev:web');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
