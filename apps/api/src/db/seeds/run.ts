import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import type pg from 'pg';
import { getPool, closePool } from '../pool';
import { SEED_LAYERS, type SeedLayer } from './registry';
import { versionsService } from '../../modules/versions/service';

function geomExpr(layer: SeedLayer): string {
  // $GEOM is the feature geometry as a GeoJSON string
  const base = `ST_SetSRID(ST_GeomFromGeoJSON($GEOM), 4326)`;
  if (layer.multiPolygon || layer.multiLine) return `ST_Multi(${base})`;
  return base;
}

// Load every feature of `layer` into a fresh version, stamped with versionId.
// No ON CONFLICT: a new version starts empty, so there is nothing to conflict with.
export async function loadLayerFeatures(
  client: pg.PoolClient,
  layer: SeedLayer,
  versionId: string
): Promise<number> {
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
    // With geometry the version is the parameter after it; without geometry no
    // geometry parameter is bound, so the version takes that slot instead.
    const versionParamIndex = hasGeometry ? colNames.length + 2 : colNames.length + 1;

    const sql = `
      INSERT INTO water.${layer.table} (${colNames.join(', ')}, geom, dataset_version_id)
      VALUES (${colPlaceholders.join(', ')}, ${geomSql}, $${versionParamIndex})
    `;
    const params = hasGeometry
      ? [...values, JSON.stringify(f.geometry), versionId]
      : [...values, versionId];
    await client.query(sql, params);
    count++;
  }
  return count;
}

export async function runSeeds(): Promise<Record<string, number>> {
  const pool = getPool();
  const client = await pool.connect();
  const versions = versionsService(pool);
  const result: Record<string, number> = {};
  try {
    for (const layer of SEED_LAYERS) {
      // One transaction per layer: create the version, load its features, record the
      // count, then flip active. A failure anywhere rolls the whole layer back and
      // leaves the previously-active version untouched.
      await client.query('BEGIN');
      const versionId = await versions.createIngestVersion(client, {
        layerKey: layer.table,
        source: layer.source,
        label: layer.label,
      });
      result[layer.table] = await loadLayerFeatures(client, layer, versionId);
      await client.query(
        `UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`,
        [result[layer.table], versionId]
      );
      await versions.activate(client, layer.table, versionId);
      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`seeded water.${layer.table}: ${result[layer.table]} features (version ${versionId})`);
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
