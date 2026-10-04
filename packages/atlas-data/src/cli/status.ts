import pg from 'pg';
import { loadDevEnv } from './env';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { computeStatus, formatStatus } from '../status';

async function main(): Promise<void> {
  const envFile = loadDevEnv();
  if (envFile) console.log(`(environment from ${envFile})`);
  validateRegistry();

  // atlas:status takes no flags; a stray argument (e.g. a typo'd --only) must be
  // rejected rather than silently ignored, and rejected before the pool exists.
  const argv = process.argv.slice(2);
  if (argv.length > 0) {
    console.error(`atlas:status: unexpected argument "${argv[0]}" (atlas:status takes no arguments)`);
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });

  try {
    for (const line of formatStatus(await computeStatus(pool, ALL_DATASETS))) console.log(line);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
