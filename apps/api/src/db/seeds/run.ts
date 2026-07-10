import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import type pg from 'pg';
import { getPool, closePool } from '../pool';
import { SEED_LAYERS, type SeedLayer } from './registry';

/** Bare (non-Multi) empty-geometry WKT literal for the layer's base geometry type. */
function emptyGeomWkt(layer: SeedLayer): string {
  if (layer.multiPolygon) return 'POLYGON EMPTY';
  if (layer.multiLine) return 'LINESTRING EMPTY';
  return 'POINT EMPTY';
}

function geomExpr(layer: SeedLayer, hasGeometry: boolean): string {
  if (!hasGeometry) {
    // Source feature has no geometry (e.g. missing coordinates upstream). Insert a
    // valid, correctly-typed empty geometry instead of letting ST_GeomFromGeoJSON
    // throw on null input, which would roll back the whole layer's transaction.
    const base = `ST_GeomFromText('${emptyGeomWkt(layer)}', 4326)`;
    return layer.multiPolygon || layer.multiLine ? `ST_Multi(${base})` : base;
  }
  // $GEOM is the feature geometry as a GeoJSON string
  const base = `ST_SetSRID(ST_GeomFromGeoJSON($GEOM), 4326)`;
  if (layer.multiPolygon) return `ST_Multi(${base})`;
  if (layer.multiLine) return `ST_Multi(${base})`;
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
        `water.${layer.table}: feature with external_id=${String(cols.external_id)} has no geometry; storing empty geometry placeholder`
      );
    }

    // Placeholders: $1..$n for columns, then geometry as the last param (only when present)
    const colPlaceholders = colNames.map((_, i) => `$${i + 1}`);
    const geomParamIndex = colNames.length + 1;
    const geomSql = hasGeometry ? geomExpr(layer, true).replace('$GEOM', `$${geomParamIndex}`) : geomExpr(layer, false);

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

// Run when invoked directly (npm run seed), but not when imported as a module
// (e.g. by seed.test.ts) — otherwise this side effect would fire on import and
// race with / tear down the pool the importer manages itself.
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
