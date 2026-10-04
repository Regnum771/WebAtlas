import pg from 'pg';
import { loadDevEnv } from './env';
import { unexpectedArgument } from './composeFlag';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { verifyAtlas, formatVerify } from '../verify';
import { probeContext } from '../probes';

async function main(): Promise<void> {
  const envFile = loadDevEnv();
  if (envFile) console.log(`(environment from ${envFile})`);
  validateRegistry();
  if (process.argv.length > 2) {
    console.error(unexpectedArgument('atlas:verify', process.argv[2]));
    process.exitCode = 1;
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });
  try {
    const { lines, ok } = formatVerify(await verifyAtlas(pool, ALL_DATASETS, probeContext(pool)));
    for (const line of lines) console.log(line);
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
