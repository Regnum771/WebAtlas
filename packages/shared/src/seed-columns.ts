import { assignDamStatus } from './dam-status.js';

/** Map a GeoJSON feature's properties to `{ column: value }`, excluding geometry. */
export type ColumnMap = (props: Record<string, unknown>, index: number) => Record<string, unknown>;

/**
 * How each seed file's properties become columns of its `water.<layer>` table. Here, beside the
 * layer keys and attribute definitions, so the API's seed command and the dataset pipeline's
 * load-geojson stage read one mapping and cannot drift (INV-4).
 *
 * `rivers` is not in this record: it loads from two files with two mappings, below.
 */
export const SEED_LAYER_COLUMNS = {
  dams: (p) => ({
    external_id: p.ID,
    name: p.Vietnamese,
    name_en: p.English_hy,
    wattage_mw: p.Wattage_PL,
    annual_output: p['Quantity_('],
    year_launched: p.Year_of_la,
    year_operational: p.Year_of_op,
    status: assignDamStatus(p.ID),
  }),
  stations: (p) => ({ external_id: p.id, name: p.name, station_type: p.type, status: p.status, value: p.value }),
  flood_zones: (p) => ({ external_id: p.id, name: p.name, hazard_type: p.type, area: p.area, risk_level: p.riskLevel }),
  drought_points: (p) => ({ external_id: p.id, name: p.name, risk_level: p.riskLevel, status: p.status, survey_date: p.surveyDate }),
  saltwater_intrusion: (p) => ({ external_id: p.id, name: p.name, salinity: p.salinity, risk_level: p.riskLevel, status: p.status }),
  flood_generation: (p) => ({ external_id: p.id, name: p.name, risk_level: p.riskLevel, area: p.area, flow_rate: p.flowRate }),
  // OSM has lake names (HydroLAKES does not) and far better coverage. The cost: no
  // Vol_total / Shore_len, which OSM does not carry.
  lakes: (p) => ({
    external_id: p.osmId,
    name: p.name,
    lake_type: p.lakeType,
    area_km2: null,
    volume_mcm: null,
    shore_len_km: null,
  }),
} satisfies Record<string, ColumnMap>;

/**
 * OSM waterways as level-3 rows of water.rivers. Unlike HydroRIVERS, OSM has river names, and
 * `stream_order` here is a rank by waterway type, not a Strahler order.
 */
export const RIVER_WAY_COLUMNS: ColumnMap = (p) => ({
  // 'osm:' so an OSM way id can never be mistaken for a HYRIV_ID (migration 18).
  external_id: `osm:${String(p.osmId)}`,
  code: p.waterway,
  name: p.name,
  stream_order: p.streamOrder,
  // Computed from the geometry by build-osm-seeds.mjs; OSM has no such field.
  length_m: p.lengthM,
});

/**
 * HydroRIVERS reaches as level-2 rows of water.rivers. A reach row is the network edge: its
 * geometry is the span and flows_into_external_id its single outgoing adjacency.
 *
 * MAIN_RIV is in the seed file but deliberately not loaded: no column holds it, and overloading
 * `code` (the OSM waterway type at level 3) would make a column's meaning depend on the row's level.
 */
export const RIVER_REACH_COLUMNS: ColumnMap = (p) => ({
  external_id: `hyriv:${String(p.HYRIV_ID)}`,
  feature_level: 2,
  // HydroRIVERS writes 0 for a terminal reach -> NULL, "end of the network". A NEXT_DOWN that is
  // simply not in the file (a reach leaving the region) keeps its value: "the water goes somewhere
  // we do not hold" is a different fact, and collapsing both to NULL would hide it from the gates.
  flows_into_external_id: Number(p.NEXT_DOWN) === 0 ? null : `hyriv:${String(p.NEXT_DOWN)}`,
  // The true Strahler order (ORD_STRA). Level 3 keeps the OSM waterway rank: two different
  // measures that must not be compared.
  stream_order: p.ORD_STRA,
  length_m: Number(p.LENGTH_KM) * 1000,
  // HydroRIVERS has no names; the joined name is recorded on the link, never here.
  name: null,
});
