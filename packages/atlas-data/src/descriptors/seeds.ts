import { defineDataset } from '../schema';
import { allOf, rowCount, viewCount, wfsAnswers } from '../probes';

/** The versioned thematic layers `npm run seed` loads. Keep in sync with apps/api/src/db/seeds/registry.ts. */
export const SEED_LAYERS = [
  'dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation', 'lakes',
] as const;

/**
 * Runbook step 3 as one `run` stage until Plan C splits it into admin_boundaries plus one load-geojson
 * dataset per layer (spec §10). `npm run seed` also loads admin.provinces/admin.wards, which every
 * water layer's activation stamps against — hence rivers dependsOn seeds.
 *
 * Idempotency is the command's, not the runner's: `seed` appends a new version per layer each time it
 * runs, so this stage runs only when forced, when its descriptor changes, or on a fresh machine.
 */
export const seeds = defineDataset({
  id: 'seeds',
  kind: 'vector',
  editable: true,
  lineage: {
    statement:
      'Các lớp chuyên đề nạp từ GeoJSON đã commit: đập thuỷ điện, hồ, và năm lớp minh hoạ tổng hợp; ' +
      'kèm ranh giới tỉnh/xã dùng để gán mã hành chính.',
    licence: 'CC-BY-SA-4.0 AND ODbL-1.0',
    sources: [
      {
        citation: 'Open Development Vietnam, Hydropower plants in Vietnam by October 2020',
        licence: 'CC-BY-SA-4.0',
        uri: 'https://data.opendevelopmentmekong.net/en/dataset/hydropower-plants-in-vietnam-by-october-2020',
      },
      { citation: 'OpenStreetMap contributors (lakes)', licence: 'ODbL-1.0', uri: 'https://www.openstreetmap.org/' },
      {
        citation: 'Synthetic demonstration data from the original prototype (stations, flood zones, drought points, saltwater intrusion, flood generation) — not measurements',
        licence: 'LicenseRef-webatlas-synthetic',
      },
      {
        citation: 'thanglequoc/vietnamese-provinces-database — boundaries after the 2025-07-01 reorganisation',
        licence: 'MIT',
        uri: 'https://github.com/thanglequoc/vietnamese-provinces-database',
      },
    ],
  },
  stages: [
    {
      type: 'run',
      in: 'host',
      argv: ['run', 'seed', '-w', '@webatlas/api'],
      produces: 'admin.provinces, admin.wards, and one new active version of each seed layer',
      promoteTo: 'load-geojson',
      promoteBy: '2026-12-31',
    },
    ...SEED_LAYERS.map((layer) => ({ type: 'publish-geoserver' as const, layer })),
  ],
  probe: allOf(
    rowCount('admin.provinces', 'SELECT count(*)::text AS n FROM admin.provinces', 34),
    rowCount('admin.wards', 'SELECT count(*)::text AS n FROM admin.wards'),
    ...SEED_LAYERS.map((layer) => allOf(viewCount(layer), wfsAnswers(layer)))
  ),
});
