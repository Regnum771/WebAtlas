import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { FeatureLoadSpec } from '@webatlas/versioning';
import { SEED_LAYER_COLUMNS } from '@webatlas/shared';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/db/seeds -> repo root is five levels up. The seed files live with the dataset
// pipeline since Plan C-2; this command reads them there until C-3 removes it.
const repoRoot = resolve(here, '../../../../..');
const seedData = resolve(repoRoot, 'packages/atlas-data/data/seeds');

/** A load spec plus its provenance: the origin recorded on the dataset_versions row. */
export type SeedLayer = FeatureLoadSpec & { source: string };

export const SEED_LAYERS: SeedLayer[] = [
  {
    table: 'dams',
    file: resolve(seedData, 'dams.geojson'),
    // The file was renamed dams.geojson; the source string is what existing versions carry.
    source: 'thuydienvietnam.geojson',
    columns: SEED_LAYER_COLUMNS.dams,
  },
  {
    table: 'stations',
    file: resolve(seedData, 'stations.geojson'),
    source: 'stations.geojson',
    columns: SEED_LAYER_COLUMNS.stations,
  },
  {
    table: 'flood_zones',
    file: resolve(seedData, 'flood_zones.geojson'),
    source: 'flood_zones.geojson',
    multiPolygon: true,
    columns: SEED_LAYER_COLUMNS.flood_zones,
  },
  {
    table: 'drought_points',
    file: resolve(seedData, 'drought_points.geojson'),
    source: 'drought_points.geojson',
    columns: SEED_LAYER_COLUMNS.drought_points,
  },
  {
    table: 'saltwater_intrusion',
    file: resolve(seedData, 'saltwater_intrusion.geojson'),
    source: 'saltwater_intrusion.geojson',
    columns: SEED_LAYER_COLUMNS.saltwater_intrusion,
  },
  {
    table: 'flood_generation',
    file: resolve(seedData, 'flood_generation.geojson'),
    source: 'flood_generation.geojson',
    multiPolygon: true,
    columns: SEED_LAYER_COLUMNS.flood_generation,
  },
  {
    table: 'lakes',
    file: resolve(seedData, 'osm-lakes-region.geojson'),
    // OSM có tên hồ (HydroLAKES không có) và độ phủ cao hơn nhiều.
    // Đánh đổi: mất Vol_total/Shore_len — OSM không có hai trường này.
    source: 'OSM water bodies',
    multiPolygon: true,
    columns: SEED_LAYER_COLUMNS.lakes,
  },
];
