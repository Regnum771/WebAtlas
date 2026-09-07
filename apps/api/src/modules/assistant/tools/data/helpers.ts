import type { Pool } from 'pg';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';

/** How many rows any single data tool will list. Beyond this the model is
 *  reading a table out loud rather than answering a question, and the tokens
 *  are wasted. Counts are still reported in full. */
export const ROW_LIMIT = 25;

/**
 * The active-version view for a layer.
 *
 * The key arrives as a model-chosen tool argument and is interpolated into SQL
 * (a table name cannot be a bind parameter), so it is checked against the known
 * key set first. This is the only place in the data tools where any part of a
 * query is built from a tool argument that is not a bind parameter.
 */
export function layerView(key: EditableLayerKey): string {
  if (!(EDITABLE_LAYER_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Unknown layer key: ${String(key)}`);
  }
  return `water.${key}_active`;
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

/** One row as every list-shaped data tool reports it. */
export interface FeatureRow {
  featureId: string;
  name: string | null;
  lon: number;
  lat: number;
}

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
