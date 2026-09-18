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
 * The active-version view for a layer. This is the only place in the data
 * tools where any part of a query is built from a tool argument that is not
 * a bind parameter — other than candidateCtes/layerTable below, which exist
 * only to reach the same base table this view is built on.
 */
export function layerView(key: EditableLayerKey): string {
  assertKnownLayer(key);
  return `water.${key}_active`;
}

/**
 * The base table behind a layer's active-version view. Exists only for
 * candidateCtes below, where a predicate must reach the base table's indexes
 * directly rather than go through the view (see its doc comment for why).
 * Goes through the same allowlist check as layerView.
 */
export function layerTable(key: EditableLayerKey): string {
  assertKnownLayer(key);
  return `water.${key}`;
}

/**
 * Builds the candidate-then-resolve CTE chain that lets a predicate reach an
 * index on the base table, instead of hitting the wall documented in
 * modules/search/repository.ts's layerCtes: water.<layer>_active resolves the
 * active dataset-version chain through a materialised WITH RECURSIVE +
 * DISTINCT ON pipeline, which is an optimizer fence. A predicate applied on
 * top of the view cannot be pushed down into it, so querying the view
 * directly forces a full scan + dedup of the whole layer before the
 * predicate ever runs. This builds the identical resolution logic here,
 * *below* a candidate step that runs directly against the base table, where
 * its indexes are reachable.
 *
 * `candidateQuery` must be a complete `SELECT ... FROM ${layerTable(key)} ...`
 * that returns an `external_id` column, expressed so the base table's index
 * can serve it directly — a `WHERE` predicate (e.g. `geom && envelope`) or an
 * `ORDER BY ... LIMIT` for a bounded KNN over-fetch. It must use bind
 * parameters for every value that comes from tool input; the layer key is the
 * only tool-chosen value ever interpolated as text, and only via this
 * function or layerView, both gated by assertKnownLayer. Do not add another
 * place that interpolates tool input into the SQL this returns.
 *
 * The candidate step runs across *every* version of the base table, so it
 * returns a superset of what the active version actually contains — a row
 * that matched in some other edit/ingest version may not match once resolved
 * to the active chain. Callers MUST re-apply their real predicate (and
 * `NOT deleted`) when selecting from the `resolved` relation this exposes;
 * the candidate query only narrows the scan, it is not the authoritative
 * filter.
 *
 * `prefix` lets two independent CTE chains coexist in one `WITH` — the fixed
 * names (`active_layer`, `chain_layer`, `candidates_layer`, `resolved`) would
 * otherwise collide when a tool spans two layers (or the same layer twice,
 * e.g. distance between two dams). Pass a distinct prefix per chain in that
 * case (e.g. `'from_'` / `'to_'`); the resolved relation is then
 * `${prefix}resolved`. Left at the default `''`, the emitted names are
 * byte-identical to the unprefixed originals, so existing single-chain
 * callers need no change.
 */
export function candidateCtes(key: EditableLayerKey, candidateQuery: string, prefix = ''): string {
  const table = layerTable(key);
  const active = `${prefix}active_layer`;
  const chain = `${prefix}chain_layer`;
  const candidates = `${prefix}candidates_layer`;
  const resolved = `${prefix}resolved`;
  return `
    ${active} AS (
      SELECT id FROM app.dataset_versions WHERE layer_key = '${key}' AND is_active
    ),
    ${chain} AS (
      SELECT v.id, v.parent_version_id, 0 AS depth
        FROM app.dataset_versions v JOIN ${active} a ON v.id = a.id
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN ${chain} c ON p.id = c.parent_version_id
    ),
    ${candidates} AS (
      SELECT DISTINCT external_id FROM (${candidateQuery}) AS candidate
    ),
    ${resolved} AS (
      SELECT DISTINCT ON (t.external_id) t.*
        FROM ${table} t
        JOIN ${chain} c ON t.dataset_version_id = c.id
        JOIN ${candidates} ci ON ci.external_id = t.external_id
        ORDER BY t.external_id, c.depth
    )`;
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
 * One feature of the ACTIVE version, by id — the shared form of the
 * candidate/re-apply dance that area_of, distance_between and related_features
 * each hand-wrote (handover §5.3 #1).
 *
 * The candidate predicate `id = $1` is a primary-key hit on the base table; it is
 * re-applied after resolution together with `NOT deleted`, because resolution
 * returns the active row for that external_id — if the id belonged to a
 * superseded version, the active row's id differs and the filter yields nothing.
 */
export async function resolveFeature(
  db: Queryable,
  layerKey: EditableLayerKey,
  featureId: string,
  opts: { simplify?: boolean } = {}
): Promise<ResolvedFeature | null> {
  if (!isFeatureId(featureId)) return null;
  const table = layerTable(layerKey); // allowlist check before any interpolation
  // Column names come from the shared constant map, never from tool input.
  const props = Object.keys(LAYER_ATTRIBUTE_MAP[layerKey].attributes)
    .map((c) => `'${c}', resolved.${c}::text`)
    .join(', ');
  const geometrySql = opts.simplify === false ? 'ST_AsGeoJSON(geom, 7)::json' : simplifiedGeoJsonSql('geom');
  const ctes = candidateCtes(layerKey, `SELECT external_id FROM ${table} WHERE id = $1`);
  const { rows } = await db.query<ResolvedFeature>(
    `WITH RECURSIVE ${ctes}
     SELECT id::text AS "featureId", name, ${POINT_SQL},
            ${geometrySql} AS geometry,
            jsonb_build_object(${props}) AS properties
       FROM resolved
      WHERE id = $1 AND NOT deleted AND geom IS NOT NULL`,
    [featureId]
  );
  return rows[0] ?? null;
}
