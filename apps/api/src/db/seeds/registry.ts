import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { assignDamStatus } from './damStatus';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/db/seeds -> repo root is five levels up
const repoRoot = resolve(here, '../../../../..');
const webPublic = resolve(repoRoot, 'apps/web/public');
const seedData = resolve(here, 'data');

export interface SeedLayer {
  table: string;
  file: string;
  /** true if the source geometry is a single Polygon that must be wrapped as MultiPolygon */
  multiPolygon?: boolean;
  /** true if the source geometry is a single LineString/MultiLineString to normalise as MultiLineString */
  multiLine?: boolean;
  /**
   * Map a GeoJSON feature's properties to a { column: value } object (excluding geom).
   * `index` is the feature's 0-based position within the source file, for layers whose
   * source data has no reliable per-feature unique key.
   */
  columns: (props: Record<string, unknown>, index: number) => Record<string, unknown>;
}

export const SEED_LAYERS: SeedLayer[] = [
  {
    table: 'dams',
    file: resolve(webPublic, 'thuydienvietnam.geojson'),
    columns: (p) => ({
      external_id: p.ID,
      name: p.Vietnamese,
      name_en: p.English_hy,
      wattage_mw: p.Wattage_PL,
      annual_output: p['Quantity_('],
      year_launched: p.Year_of_la,
      year_operational: p.Year_of_op,
      status: assignDamStatus(p.ID),
    }),
  },
  {
    table: 'rivers',
    file: resolve(webPublic, 'thuyhe.geojson'),
    multiLine: true,
    // NOTE: OBJECTID is not a reliable per-feature key in this source file — 24 groups
    // of genuinely distinct segments (different Cap/Chieu_dai/geometry) share an
    // OBJECTID, which would collapse 2013 features down to 1979 rows under
    // ON CONFLICT (external_id). Use the feature's stable position in the file instead.
    columns: (p, index) => ({
      external_id: index + 1,
      code: p.Ma,
      name: p.Ten,
      stream_order: p.Cap,
      length_m: p.Chieu_dai,
    }),
  },
  {
    table: 'stations',
    file: resolve(seedData, 'stations.geojson'),
    columns: (p) => ({ external_id: p.id, name: p.name, station_type: p.type, status: p.status, value: p.value }),
  },
  {
    table: 'flood_zones',
    file: resolve(seedData, 'flood_zones.geojson'),
    multiPolygon: true,
    columns: (p) => ({ external_id: p.id, name: p.name, hazard_type: p.type, area: p.area, risk_level: p.riskLevel }),
  },
  {
    table: 'drought_points',
    file: resolve(seedData, 'drought_points.geojson'),
    columns: (p) => ({ external_id: p.id, name: p.name, risk_level: p.riskLevel, status: p.status, survey_date: p.surveyDate }),
  },
  {
    table: 'saltwater_intrusion',
    file: resolve(seedData, 'saltwater_intrusion.geojson'),
    columns: (p) => ({ external_id: p.id, name: p.name, salinity: p.salinity, risk_level: p.riskLevel, status: p.status }),
  },
  {
    table: 'flood_generation',
    file: resolve(seedData, 'flood_generation.geojson'),
    multiPolygon: true,
    columns: (p) => ({ external_id: p.id, name: p.name, risk_level: p.riskLevel, area: p.area, flow_rate: p.flowRate }),
  },
];
