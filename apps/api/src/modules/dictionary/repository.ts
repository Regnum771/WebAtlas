import type { Pool, PoolClient } from 'pg';

type Q = Pool | PoolClient;

export interface FeatureTypeRow {
  key: string; kind: 'vector' | 'raster'; name: string; definition: string;
  table_name: string | null; crs: number; geometry_type: string | null; geometry_meaning: string;
  valid_from: string; valid_to: string | null;
}
export interface AttributeRow {
  feature_type: string; name: string; source: string; value_type: string; label: string; definition: string;
  stored_unit: string | null; display_units: string[]; display_unit: string | null; precision: number | null;
  cf_standard_name: string | null; code_list: string | null; nodata: number | null; scale: number | null;
  value_offset: number | null; valid_from: string; valid_to: string | null;
}
export interface ValueRow {
  feature_type: string; attribute: string; code: string; name: string; definition: string | null;
  ord: number; retired: boolean; color_hint: string | null;
}

const DATE = (c: string) => `to_char(${c}, 'YYYY-MM-DD')`;

export async function listFeatureTypes(q: Q, key?: string): Promise<FeatureTypeRow[]> {
  const { rows } = await q.query<FeatureTypeRow>(
    `SELECT key, kind, name, definition, table_name, crs, geometry_type, geometry_meaning,
            ${DATE('valid_from')} AS valid_from, ${DATE('valid_to')} AS valid_to
       FROM app.dictionary_feature_types
      WHERE ($1::text IS NULL OR key = $1)
      ORDER BY key`, [key ?? null]);
  return rows;
}

export async function listAttributes(q: Q, key?: string): Promise<AttributeRow[]> {
  const { rows } = await q.query<AttributeRow>(
    `SELECT feature_type, name, source, value_type, label, definition, stored_unit, display_units,
            display_unit, precision, cf_standard_name, code_list, nodata, scale, value_offset,
            ${DATE('valid_from')} AS valid_from, ${DATE('valid_to')} AS valid_to
       FROM app.dictionary_attributes
      WHERE ($1::text IS NULL OR feature_type = $1)
      ORDER BY feature_type, ord`, [key ?? null]);
  return rows;
}

export async function listValues(q: Q, key?: string): Promise<ValueRow[]> {
  const { rows } = await q.query<ValueRow>(
    `SELECT feature_type, attribute, code, name, definition, ord, retired, color_hint
       FROM app.dictionary_values
      WHERE ($1::text IS NULL OR feature_type = $1)
      ORDER BY feature_type, attribute, ord`, [key ?? null]);
  return rows;
}

/** The raw ingredients of the dictionary version: latest sync, latest history change, row counts. */
export async function versionParts(q: Q): Promise<string> {
  const { rows } = await q.query<{ parts: string }>(
    `SELECT concat_ws('|',
        (SELECT max(synced_at) FROM app.dictionary_feature_types),
        (SELECT max(changed_at) FROM app.dictionary_history),
        (SELECT count(*) FROM app.dictionary_feature_types),
        (SELECT count(*) FROM app.dictionary_attributes),
        (SELECT count(*) FROM app.dictionary_values),
        (SELECT count(*) FROM app.dictionary_history)) AS parts`);
  return rows[0]!.parts;
}
