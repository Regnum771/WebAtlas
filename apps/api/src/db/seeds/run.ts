import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import type pg from 'pg';
import { getPool, closePool } from '../pool';
import { SEED_LAYERS, type SeedLayer } from './registry';

function geomExpr(layer: SeedLayer): string {
  // $GEOM is the feature geometry as a GeoJSON string
  const base = `ST_SetSRID(ST_GeomFromGeoJSON($GEOM), 4326)`;
  if (layer.multiPolygon || layer.multiLine) return `ST_Multi(${base})`;
  return base;
}

export async function seedLayer(client: pg.PoolClient, layer: SeedLayer): Promise<number> {
  const fc = JSON.parse(readFileSync(layer.file, 'utf8'));
  const features: Array<{ geometry: unknown; properties: Record<string, unknown> }> = fc.features;
  let count = 0;

  for (const [index, f] of features.entries()) {
    const cols = layer.columns(f.properties, index);
    const colNames = Object.keys(cols);
    const values = Object.values(cols);
    const hasGeometry = f.geometry != null;

    if (!hasGeometry) {
      // eslint-disable-next-line no-console
      console.warn(
        `water.${layer.table}: feature external_id=${String(cols.external_id)} has no geometry; storing NULL`
      );
    }

    const colPlaceholders = colNames.map((_, i) => `$${i + 1}`);
    const geomParamIndex = colNames.length + 1;
    const geomSql = hasGeometry ? geomExpr(layer).replace('$GEOM', `$${geomParamIndex}`) : 'NULL';

    const updateSet = colNames
      .filter((c) => c !== 'external_id')
      .map((c) => `${c} = EXCLUDED.${c}`)
      .concat(`geom = EXCLUDED.geom`, `updated_at = now()`)
      .join(', ');

    const sql = `
      INSERT INTO water.${layer.table} (${colNames.join(', ')}, geom)
      VALUES (${colPlaceholders.join(', ')}, ${geomSql})
      ON CONFLICT (external_id) DO UPDATE SET ${updateSet}
    `;
    const params = hasGeometry ? [...values, JSON.stringify(f.geometry)] : values;
    await client.query(sql, params);
    count++;
  }
  return count;
}

export async function runSeeds(): Promise<Record<string, number>> {
  const pool = getPool();
  const client = await pool.connect();
  const result: Record<string, number> = {};
  try {
    for (const layer of SEED_LAYERS) {
      await client.query('BEGIN');
      result[layer.table] = await seedLayer(client, layer);
      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`seeded water.${layer.table}: ${result[layer.table]} features`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return result;
}

// Run when invoked directly (npm run seed), but not when imported (e.g. by seed.test.ts).
const isMainModule = process.argv[1] != null && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (isMainModule) {
  runSeeds()
    .then(() => closePool())
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exitCode = 1;
      return closePool();
    });
}
