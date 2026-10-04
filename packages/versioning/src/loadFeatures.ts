import { readFileSync } from 'node:fs';
import type pg from 'pg';

/** What to load into one version of one layer. Comes from descriptor code, never from input. */
export interface FeatureLoadSpec {
  /** The table under `water.`; also the layer key. */
  table: string;
  /** Absolute path of a GeoJSON FeatureCollection. */
  file: string;
  /** Wrap a single Polygon as MultiPolygon. */
  multiPolygon?: boolean;
  /** Normalise a LineString or MultiLineString as MultiLineString. */
  multiLine?: boolean;
  /**
   * Map a feature's properties to `{ column: value }`, excluding geometry. `index` is the
   * feature's 0-based position in the file, for sources with no reliable per-feature key.
   */
  columns: (props: Record<string, unknown>, index: number) => Record<string, unknown>;
}

function geomExpr(spec: FeatureLoadSpec): string {
  // $GEOM is the feature geometry as a GeoJSON string
  const base = `ST_SetSRID(ST_GeomFromGeoJSON($GEOM), 4326)`;
  if (spec.multiPolygon || spec.multiLine) return `ST_Multi(${base})`;
  return base;
}

/**
 * Load every feature of `spec.file` into `water.<spec.table>`, stamped with `versionId`, on the
 * caller's client and inside the caller's transaction. Returns the number of rows inserted.
 * No ON CONFLICT: a new version starts empty, so there is nothing to conflict with.
 */
export async function loadFeatures(
  client: pg.PoolClient,
  spec: FeatureLoadSpec,
  versionId: string
): Promise<number> {
  const fc = JSON.parse(readFileSync(spec.file, 'utf8'));
  const features: Array<{ geometry: unknown; properties: Record<string, unknown> }> = fc.features;
  let count = 0;

  for (const [index, f] of features.entries()) {
    const cols = spec.columns(f.properties, index);
    const colNames = Object.keys(cols);
    // Interpolated below: a column map must return plain column names, never keys taken from data.
    for (const name of colNames) {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
        throw new Error(`water.${spec.table}: "${name}" is not a column name`);
      }
    }
    const values = Object.values(cols);
    const hasGeometry = f.geometry != null;

    if (!hasGeometry) {
      // eslint-disable-next-line no-console
      console.warn(
        `water.${spec.table}: feature external_id=${String(cols.external_id)} has no geometry; storing NULL`
      );
    }

    const colPlaceholders = colNames.map((_, i) => `$${i + 1}`);
    const geomParamIndex = colNames.length + 1;
    const geomSql = hasGeometry ? geomExpr(spec).replace('$GEOM', `$${geomParamIndex}`) : 'NULL';
    // With geometry the version is the parameter after it; without geometry no
    // geometry parameter is bound, so the version takes that slot instead.
    const versionParamIndex = hasGeometry ? colNames.length + 2 : colNames.length + 1;

    const sql = `
      INSERT INTO water.${spec.table} (${colNames.join(', ')}, geom, dataset_version_id)
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
