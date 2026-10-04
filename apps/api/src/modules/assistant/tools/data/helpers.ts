import type { Pool } from 'pg';
import {
  EDITABLE_LAYER_KEYS,
  LAYER_ATTRIBUTE_MAP,
  type EditableLayerKey,
  type GeoJsonGeometry,
} from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../../lib/resultGeometry';

/** How many rows any single data tool will list. Beyond this the model is
 *  reading a table out loud rather than answering a question, and the tokens
 *  are wasted. Counts are still reported in full. */
export const ROW_LIMIT = 25;

/**
 * Throws for anything outside EDITABLE_LAYER_KEYS. The layer key arrives as a
 * model-chosen tool argument and is interpolated into SQL below (a table/view
 * name cannot be a bind parameter), so every place that interpolates it — in
 * this file or a caller's — must go through this check first.
 */
function assertKnownLayer(key: EditableLayerKey): void {
  if (!(EDITABLE_LAYER_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Unknown layer key: ${String(key)}`);
  }
}

/**
 * The active-state view for a layer: a plain filter on the rows' stored is_current flag
 * (migration 22), so a predicate on it reaches the table's partial indexes. This is the only
 * place in the data tools where any part of a query is built from a tool argument that is not
 * a bind parameter, and it goes through assertKnownLayer first.
 */
export function layerView(key: EditableLayerKey): string {
  assertKnownLayer(key);
  return `water.${key}_active`;
}

/**
 * SQL predicate that restricts a layer to its ENTITY rows. `water.rivers` holds three
 * levels since the river-topology ingest (1 = named river, 2 = HydroRIVERS reach, 3 =
 * OSM way), and any query that counts, lists, searches or ranks "rivers" means the
 * level-1 river: without this, select_within over Đắk Lắk reported 2,991 rivers where
 * there are 142 (found 2026-09-30). Every other layer has one level, so it is `true`.
 *
 * Collection queries apply it in their WHERE clause, so a LIMIT or a nearest-neighbour
 * over-fetch is not spent on reaches and ways. Lookups BY ID do not use it: a click on one
 * way must still resolve that way. Interpolated as text, but built only from the allowlisted key.
 */
export function entityPredicate(key: EditableLayerKey, alias = ''): string {
  assertKnownLayer(key);
  return key === 'rivers' ? `${alias}feature_level = 1` : 'true';
}

/** Vietnamese layer names for the model's replies — it must not translate
 *  layer keys itself and invent a name the UI never uses. */
export const LAYER_LABELS: Record<EditableLayerKey, string> = {
  dams: 'đập & hồ chứa',
  rivers: 'sông ngòi',
  lakes: 'hồ',
  stations: 'trạm quan trắc',
  flood_zones: 'vùng ngập lụt',
  drought_points: 'điểm hạn hán',
  saltwater_intrusion: 'điểm xâm nhập mặn',
  flood_generation: 'vùng sinh lũ',
};

/**
 * The label of the layer's active dataset version — what the provenance chip
 * shows, so a reader can tell which map a number describes. Null when the layer
 * has no active version (an un-ingested layer), which is itself worth showing.
 */
export async function activeVersionLabel(
  pool: Pool,
  key: EditableLayerKey
): Promise<string | null> {
  const { rows } = await pool.query<{ label: string }>(
    'SELECT label FROM app.dataset_versions WHERE layer_key = $1 AND is_active LIMIT 1',
    [key]
  );
  return rows[0]?.label ?? null;
}

/** A representative point for any geometry type — ST_PointOnSurface keeps line
 *  and polygon results navigable, the same choice modules/search made. */
export const POINT_SQL = 'ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat';

/**
 * Feature ids are uuids and arrive as model-chosen tool arguments. A malformed
 * one makes Postgres raise 22P02 rather than return no rows, which reaches the
 * model as a database error instead of an honest "no such feature".
 */
export function isFeatureId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** A pool or a checked-out client — anything with pg's `query`. */
export type Queryable = Pick<Pool, 'query'>;

export interface ResolvedFeature {
  featureId: string;
  name: string | null;
  lon: number;
  lat: number;
  geometry: GeoJsonGeometry;
  /** Every LAYER_ATTRIBUTE_MAP column, as text (null stays null). */
  properties: Record<string, string | null>;
}

/**
 * One feature of the ACTIVE state, by id: a primary-key hit on the layer's view. An id that
 * belongs to a superseded version's row is not in the view and yields null.
 */
export async function resolveFeature(
  db: Queryable,
  layerKey: EditableLayerKey,
  featureId: string,
  opts: { simplify?: boolean } = {}
): Promise<ResolvedFeature | null> {
  if (!isFeatureId(featureId)) return null;
  const view = layerView(layerKey); // allowlist check before any interpolation
  // Column names come from the shared constant map, never from tool input.
  const props = Object.keys(LAYER_ATTRIBUTE_MAP[layerKey].attributes)
    .map((c) => `'${c}', ${c}::text`)
    .join(', ');
  const geometrySql = opts.simplify === false ? 'ST_AsGeoJSON(geom, 7)::json' : simplifiedGeoJsonSql('geom');
  const { rows } = await db.query<ResolvedFeature>(
    `SELECT id::text AS "featureId", name, ${POINT_SQL},
            ${geometrySql} AS geometry,
            jsonb_build_object(${props}) AS properties
       FROM ${view}
      WHERE id = $1 AND geom IS NOT NULL`,
    [featureId]
  );
  return rows[0] ?? null;
}
