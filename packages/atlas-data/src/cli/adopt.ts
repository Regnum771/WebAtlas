import pg from 'pg';
import { loadDevEnv } from './env';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { adoptDatasets } from '../adopt';
import { probeContext } from '../probes';

async function main(): Promise<void> {
  const envFile = loadDevEnv();
  if (envFile) console.log(`(environment from ${envFile})`);
  validateRegistry();
  if (process.argv.length > 2) {
    console.error(`atlas:adopt: unexpected argument "${process.argv[2]}" (atlas:adopt takes no arguments)`);
    process.exitCode = 1;
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });
  try {
    const outcomes = await adoptDatasets(pool, ALL_DATASETS, probeContext(pool));
    for (const o of outcomes) console.log(`  ${o.result.padEnd(13)} ${o.id.padEnd(20)} ${o.detail}`);
    const adopted = outcomes.filter((o) => o.result === 'adopted').length;
    console.log(`adopted ${adopted} of ${outcomes.length}; next: npm run atlas:status`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
