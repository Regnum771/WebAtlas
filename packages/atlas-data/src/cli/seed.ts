import pg from 'pg';
import { loadDevEnv } from './env';
import { validateRegistry } from '../registry';
import { ensureSeeded } from '../ensureSeeded';

/**
 * atlas:seed — load the committed seed data (boundaries, the thematic layers, rivers) into the
 * database, through the same loader atlas:build uses, and nothing else: no build state, no
 * GeoServer. For CI and for a test database. To build an atlas, use atlas:up or atlas:build.
 */
async function main(): Promise<void> {
  // No flags: in particular it never supersedes edits. A stray argument is refused, not ignored.
  if (process.argv.length > 2) {
    throw new Error(`atlas:seed takes no arguments (got "${process.argv.slice(2).join(' ')}")`);
  }
  const envFile = loadDevEnv();
  if (envFile) console.log(`(environment from ${envFile})`);
  validateRegistry();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });
  try {
    const outcomes = await ensureSeeded(pool);
    for (const o of outcomes) console.log(`  ${o.action.padEnd(10)} ${o.id.padEnd(20)} ${o.detail}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  // The loader's message names a flag this command does not take.
  if (message.includes('--supersede-edits')) {
    console.error('atlas:seed never loads over edits. To do that deliberately: npm run atlas:build -- --supersede-edits <layer>');
  }
  process.exitCode = 1;
});
