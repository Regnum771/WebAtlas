import pg, { type Pool, type PoolClient } from 'pg';
import { DICTIONARY, UNITS, formatValue, sameDimension, type DictAttribute } from '@webatlas/shared';
import { NotFoundError, ValidationError } from '../../errors';
import { MESSAGES } from './editSchemas';
import { getFeatureType } from './service';
import type { SyncTarget } from './syncPlan';

/*
 * The stored-unit correction (spec §2.2, Plan C Task 6, Ruling 6). A correction changes what the
 * dictionary claims the stored numbers mean; it never converts the data. It is limited to a unit of
 * the same dimension (so the display units stay valid), applies from a date recorded in
 * app.dictionary_unit_periods, and is previewed first on five real values.
 */

/**
 * Where a preview reads a layer's active rows (for a versioned water layer, its `_active` view), by
 * dictionary key, and which column identifies a row. Fixed: neither the relation nor the id column
 * ever comes from a request. Keyed by layer rather than by the entry's table, so the base tables
 * are never named in code (db/activeReads.test.ts).
 */
export const PREVIEW_SOURCES: Readonly<Record<string, { relation: string; id: string }>> = {
  dams: { relation: 'water.dams_active', id: 'id' },
  lakes: { relation: 'water.lakes_active', id: 'id' },
  rivers: { relation: 'water.rivers_active', id: 'id' },
  stations: { relation: 'water.stations_active', id: 'id' },
  flood_zones: { relation: 'water.flood_zones_active', id: 'id' },
  drought_points: { relation: 'water.drought_points_active', id: 'id' },
  saltwater_intrusion: { relation: 'water.saltwater_intrusion_active', id: 'id' },
  flood_generation: { relation: 'water.flood_generation_active', id: 'id' },
  provinces: { relation: 'admin.provinces', id: 'code' },
  wards: { relation: 'admin.wards', id: 'code' },
  contours: { relation: 'basemap.contours', id: 'id' },
  flood_roads: { relation: 'scenario.flood_road', id: 'osm_id' },
  flood_stations: { relation: 'scenario.flood_station', id: 'id' },
  flood_wards: { relation: 'scenario.flood_ward', id: 'ward_code' },
};

const PREVIEW_ROWS = 5;

const refuse = (message: string, field: string) => new ValidationError(message, { field });

/** A proposed stored unit: a known unit of the current stored unit's dimension, or 400. */
export function checkStoredUnit(current: string | undefined, proposed: string): void {
  if (current === undefined) throw refuse(MESSAGES.noStoredUnit, 'storedUnit');
  const known = (u: string) => Object.hasOwn(UNITS, u);
  if (!known(proposed) || !known(current) || !sameDimension(proposed, current)) throw refuse(MESSAGES.storedUnit, 'storedUnit');
}

/**
 * The column a preview reads: an attribute the CODE entry stores in a column of a vector table with
 * a fixed preview source. Anything else (a raster band, an extra key) has no rows to show.
 */
function previewColumn(layer: string, attribute: string): { relation: string; id: string; column: string } | null {
  const entry = Object.hasOwn(DICTIONARY, layer) ? DICTIONARY[layer] : undefined;
  if (!entry || entry.kind !== 'vector' || !Object.hasOwn(PREVIEW_SOURCES, layer)) return null;
  const codeAttribute = entry.attributes.find((a) => a.name === attribute);
  if (!codeAttribute || codeAttribute.source !== 'column') return null;
  return { ...PREVIEW_SOURCES[layer]!, column: codeAttribute.name };
}

/** node-pg returns numeric and bigint columns as strings; the preview serves numbers. */
function asNumber(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
}

export interface PreviewRow {
  id: string;
  stored: unknown;
  /** formatValue under the current stored unit. */
  before: string;
  /** formatValue under the proposed stored unit. */
  after: string;
}

/** POST /api/dictionary/:layer/:attribute/stored-unit/preview: up to five real values, before and after. */
export async function previewStoredUnit(pool: Pool, layer: string, attribute: string, proposed: string): Promise<{ rows: PreviewRow[] }> {
  const featureType = await getFeatureType(pool, layer);
  if (!featureType) throw new NotFoundError(`Không có lớp "${layer}" trong từ điển dữ liệu.`);
  const served = featureType.attributes.find((a) => a.name === attribute);
  if (!served) throw new NotFoundError(`Không có thuộc tính "${attribute}" của lớp "${layer}" trong từ điển dữ liệu.`);
  checkStoredUnit(served.storedUnit, proposed);

  const source = previewColumn(layer, attribute);
  if (!source) return { rows: [] };
  const { revision: _revision, ...current } = served;
  const corrected: DictAttribute = { ...current, storedUnit: proposed };
  // Identifiers from the fixed map and the code entry, quoted all the same; the limit is bound.
  const column = pg.escapeIdentifier(source.column);
  const id = pg.escapeIdentifier(source.id);
  const { rows } = await pool.query<{ id: string; stored: unknown }>(
    `SELECT ${id}::text AS id, ${column} AS stored FROM ${source.relation}
      WHERE ${column} IS NOT NULL ORDER BY ${id} LIMIT $1`, [PREVIEW_ROWS]);
  return {
    rows: rows.map((r) => {
      const stored = asNumber(r.stored);
      return { id: r.id, stored, before: formatValue(current, stored), after: formatValue(corrected, stored) };
    }),
  };
}

/** The latest date a stored unit of this attribute applies from, if any correction was made. */
export async function latestUnitPeriod(q: PoolClient, t: SyncTarget): Promise<string | null> {
  const { rows } = await q.query<{ valid_from: string | null }>(
    `SELECT max(valid_from)::text AS valid_from FROM app.dictionary_unit_periods WHERE feature_type = $1 AND attribute = $2`,
    [t.featureType, t.attribute]);
  return rows[0]?.valid_from ?? null;
}

/**
 * Records a correction from `previousUnit` to `unit` applying from `validFrom`. The first correction
 * of an attribute also records the unit it replaces, from the attribute's own validFrom, so the
 * periods cover the whole life of the attribute. A second correction on the same date replaces the
 * first one's unit.
 */
export async function writeUnitPeriod(q: PoolClient, t: SyncTarget, change: {
  previousUnit: string; unit: string; validFrom: string; attributeValidFrom: string; userId: string;
}): Promise<void> {
  await q.query(
    `INSERT INTO app.dictionary_unit_periods (feature_type, attribute, stored_unit, valid_from, created_by)
     SELECT $1, $2, $3, $4::date, $5
      WHERE NOT EXISTS (SELECT 1 FROM app.dictionary_unit_periods WHERE feature_type = $1 AND attribute = $2)
     ON CONFLICT DO NOTHING`,
    [t.featureType, t.attribute, change.previousUnit, change.attributeValidFrom, change.userId]);
  await q.query(
    `INSERT INTO app.dictionary_unit_periods (feature_type, attribute, stored_unit, valid_from, created_by)
     VALUES ($1, $2, $3, $4::date, $5)
     ON CONFLICT (feature_type, attribute, valid_from)
     DO UPDATE SET stored_unit = EXCLUDED.stored_unit, created_by = EXCLUDED.created_by, created_at = now()`,
    [t.featureType, t.attribute, change.unit, change.validFrom, change.userId]);
}
