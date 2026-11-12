import type { Pool, PoolClient } from 'pg';
import { GeometryError } from '../../errors';
import type { LayerDef } from '../../layers/registry';

/** Allowed GeoJSON geometry `type` values per OGC layer geometry type. */
const ALLOWED: Record<LayerDef['geomType'], string[]> = {
  Point: ['Point'],
  MultiLineString: ['MultiLineString', 'LineString'],
  MultiPolygon: ['MultiPolygon', 'Polygon'],
};

/** The GeoJSON geometry types PostGIS reads; GeometryCollection is not accepted anywhere. */
const GEOJSON_TYPES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

/**
 * Validate that a value is a GeoJSON geometry object of any supported type, and return the
 * JSON string to bind as a SQL parameter. For input that belongs to no layer (e.g. the
 * managing-unit suggestion). Throws GeometryError otherwise.
 */
export function assertGeoJsonGeometry(geometry: unknown): string {
  if (typeof geometry !== 'object' || geometry === null || !('type' in geometry)) {
    throw new GeometryError('Geometry must be a GeoJSON geometry object');
  }
  const type = (geometry as { type: unknown }).type;
  if (typeof type !== 'string' || !GEOJSON_TYPES.includes(type)) {
    throw new GeometryError('Geometry type is not supported');
  }
  return JSON.stringify(geometry);
}

/**
 * Validate a parsed GeoJSON geometry against the layer's expected type and return
 * the JSON string to bind as a SQL parameter. `null`/`undefined` is allowed only
 * when the layer's geometry column is nullable (dams). Throws GeometryError otherwise.
 * PostGIS ST_IsValid / SRID normalization happen in the repository SQL.
 */
export function assertGeometry(def: LayerDef, geometry: unknown): string | null {
  if (geometry === null || geometry === undefined) {
    if (def.geomNullable) return null;
    throw new GeometryError('Geometry is required for this layer');
  }
  if (typeof geometry !== 'object' || geometry === null || !('type' in geometry)) {
    throw new GeometryError('Geometry must be a GeoJSON geometry object');
  }
  const type = (geometry as { type: unknown }).type;
  if (typeof type !== 'string' || !ALLOWED[def.geomType].includes(type)) {
    throw new GeometryError(`Geometry type must be compatible with ${def.geomType}`);
  }
  return JSON.stringify(geometry);
}

/**
 * SQL fragment converting a GeoJSON text parameter ($n) to a 4326 geometry,
 * forcing the layer's multi-type where the source may arrive single.
 */
export function geomInsertSql(def: LayerDef, n: number): string {
  const base = `ST_SetSRID(ST_GeomFromGeoJSON($${n}), 4326)`;
  if (def.geomType === 'MultiLineString') return `ST_Multi(${base})`;
  if (def.geomType === 'MultiPolygon') return `ST_Multi(${base})`;
  return base;
}

/**
 * Ask PostGIS whether the GeoJSON string parses to a valid geometry. Runs before
 * insert/update so invalid input becomes GeometryError(422), not a DB 500.
 */
export async function assertValidInPg(pg: Pool, _def: LayerDef, geometryJson: string): Promise<void> {
  return assertValidGeoJsonInPg(pg, geometryJson);
}

/** assertValidInPg without a layer: the check itself never depended on one. */
export async function assertValidGeoJsonInPg(pg: Pool | PoolClient, geometryJson: string): Promise<void> {
  const sql = `SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS valid`;
  let valid: boolean;
  try {
    const { rows } = await pg.query(sql, [geometryJson]);
    valid = rows[0]?.valid === true;
  } catch {
    throw new GeometryError('Geometry could not be parsed');
  }
  if (!valid) throw new GeometryError('Geometry is not valid');
}
