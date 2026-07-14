import { z } from 'zod';
import { EDITABLE_LAYER_KEYS, LAYER_GEOMETRY, type EditableLayerKey, type OgcGeometryType } from '@webatlas/shared';
import { NotFoundError } from '../errors';

export interface LayerDef {
  key: EditableLayerKey;
  table: string;               // always `water.<key>`
  geomType: OgcGeometryType;
  geomColumn: 'geom';
  geomNullable: boolean;
  attributeColumns: string[];  // editable, non-geometry, non-audit columns
  attributeSchema: z.ZodObject<z.ZodRawShape>;
}

// Editable attribute columns per table (from migration 1000000000002_water-schema.cjs).
// `name` is editable; id/geom/external_id/created_*/updated_* are system-managed and excluded.
const nullableStr = z.string().nullable().optional();
const nullableNum = z.number().nullable().optional();
const nullableDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date (YYYY-MM-DD)').nullable().optional();

const ATTRS: Record<EditableLayerKey, z.ZodObject<z.ZodRawShape>> = {
  dams: z.object({
    name: nullableStr, name_en: nullableStr, wattage_mw: nullableNum,
    annual_output: nullableNum, year_launched: nullableStr,
    year_operational: nullableStr, status: nullableStr,
  }),
  rivers: z.object({
    name: nullableStr, code: nullableStr, stream_order: nullableNum, length_m: nullableNum,
  }),
  stations: z.object({
    name: nullableStr, station_type: nullableStr, status: nullableStr, value: nullableStr,
  }),
  flood_zones: z.object({
    name: nullableStr, hazard_type: nullableStr, area: nullableStr, risk_level: nullableStr,
  }),
  drought_points: z.object({
    name: nullableStr, risk_level: nullableStr, status: nullableStr, survey_date: nullableDate,
  }),
  saltwater_intrusion: z.object({
    name: nullableStr, salinity: nullableStr, risk_level: nullableStr, status: nullableStr,
  }),
  flood_generation: z.object({
    name: nullableStr, risk_level: nullableStr, area: nullableStr, flow_rate: nullableStr,
  }),
};

function build(key: EditableLayerKey): LayerDef {
  const schema = ATTRS[key];
  return {
    key,
    table: `water.${key}`,
    geomType: LAYER_GEOMETRY[key],
    geomColumn: 'geom',
    geomNullable: key === 'dams',
    attributeColumns: Object.keys(schema.shape),
    attributeSchema: schema,
  };
}

export const LAYER_REGISTRY: Record<EditableLayerKey, LayerDef> = Object.fromEntries(
  EDITABLE_LAYER_KEYS.map((key) => [key, build(key)])
) as Record<EditableLayerKey, LayerDef>;

export function getLayer(key: string): LayerDef {
  const def = (LAYER_REGISTRY as Record<string, LayerDef | undefined>)[key];
  if (!def) throw new NotFoundError('Unknown layer');
  return def;
}

export function listLayerMetadata(): Array<{ key: string; geomType: OgcGeometryType; attributes: string[] }> {
  return EDITABLE_LAYER_KEYS.map((key) => {
    const def = LAYER_REGISTRY[key];
    return { key, geomType: def.geomType, attributes: def.attributeColumns };
  });
}
