import 'dotenv/config';
import { closePool, getPool } from '../db/pool';
import { buildReferenceEntities } from '../db/referenceEntities';
import { REFERENCE_LAYER_KEYS, type ReferenceLayerKey } from '../reference/registry';

/**
 * Rebuilds basemap.reference_entities.
 *
 * RUN THIS AFTER packages/atlas-data/tools/basemap/load_basemap.py. The loader replaces its own
 * tables wholesale, so every entity here is stale the moment it finishes.
 *
 * Usage:
 *   npm run reference:build -w @webatlas/api            # all layers
 *   npm run reference:build -w @webatlas/api -- roads   # one or more layers
 */
async function main(): Promise<void> {
  const requested = process.argv.slice(2) as ReferenceLayerKey[];
  const unknown = requested.filter((k) => !(REFERENCE_LAYER_KEYS as readonly string[]).includes(k));
  if (unknown.length) {
    console.error(`Unknown reference layer(s): ${unknown.join(', ')}`);
    console.error(`Known: ${REFERENCE_LAYER_KEYS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const pool = getPool();
  try {
    const started = Date.now();
    const counts = await buildReferenceEntities(pool, requested.length ? requested : undefined);
    for (const [key, n] of Object.entries(counts)) {
      console.log(`  basemap.reference_entities  ${key.padEnd(10)} ${String(n).padStart(8)} entities`);
    }
    console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
