import { defineDataset } from '../schema';
import { allOf, rowCount, wmsAnswers } from '../probes';

const TABLES = [
  'land_vn', 'roads_vn', 'railways_vn', 'places_vn', 'roads_region', 'places_region', 'landuse_region', 'water_region',
] as const;

/**
 * The pinned Geofabrik extract (spec C-10). One dated file plus its sha256, so every clone gets
 * identical data and a changed file fails the fetch instead of silently changing the basemap.
 * Not `-latest`: on 2026-09-30 every `*-latest*` alias on download.geofabrik.de 301-looped to
 * itself (Task 12), and Geofabrik prunes dated files after a while (dailies after about a week,
 * the first-of-month files after about three months; only the 1 January files stay).
 *
 * Refreshing the basemap is therefore a deliberate bump: change DATE and SHA256 together, then
 * `npm run atlas:build`. If the pinned file 404s, bump it to a current dated file the same way.
 * Geofabrik publishes no .md5 for daily .shp.zip files, so compute the sha256 of the download.
 */
const DATE = '260929';
const SHA256 = 'd20f1ea34ab96e1093a2adc45f79302b392d3d33bb9778d1826db01096a9b97d';
const FILE = `vietnam-${DATE}-free.shp.zip`;
const ZIP = `basemap/${FILE}`;

/** Runbook step 5: the self-hosted street basemap from the Geofabrik Vietnam extract (about 720 MB). */
export const basemap = defineDataset({
  id: 'basemap',
  kind: 'vector',
  lineage: {
    statement:
      'Bản đồ nền đường phố tự phục vụ, dựng từ bản trích OSM Việt Nam của Geofabrik: đường, đường sắt, ' +
      'mặt nước, sử dụng đất và địa danh (toàn quốc sơ lược, sáu tỉnh chi tiết).',
    licence: 'ODbL-1.0',
    sources: [
      {
        citation: 'OpenStreetMap contributors, via the Geofabrik Vietnam extract',
        licence: 'ODbL-1.0',
        uri: 'https://download.geofabrik.de/asia/vietnam.html',
      },
    ],
  },
  stages: [
    { type: 'fetch-http', url: `https://download.geofabrik.de/asia/${FILE}`, into: ZIP, sha256: SHA256 },
    {
      type: 'run',
      in: 'tools',
      argv: ['python3', 'packages/atlas-data/tools/basemap/load_basemap.py', `packages/atlas-data/data/cache/${ZIP}`],
      produces: 'basemap.{land_vn,roads_vn,railways_vn,places_vn,roads_region,places_region,landuse_region,water_region}',
      promoteTo: 'load-ogr',
      promoteBy: '2027-06-30',
    },
    // Order matters on a fresh GeoServer (Task 3 review): styles.py assigns styles to layers that must
    // already exist, and the layer group needs the styles. Hence featuretypes → styles → group.
    {
      type: 'run',
      in: 'tools',
      argv: ['bash', 'packages/atlas-data/tools/basemap/publish-basemap.sh', 'featuretypes'],
      produces: 'GeoServer datastore basemap_pg and the basemap feature types',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['python3', 'packages/atlas-data/tools/basemap/styles.py'],
      produces: 'GeoServer styles basemap_* assigned to the basemap layers',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['bash', 'packages/atlas-data/tools/basemap/publish-basemap.sh', 'group'],
      produces: 'GeoServer layer group webatlas:basemap, tile cache truncated',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
  ],
  // Every table load_basemap.py writes: a partial load must not pass.
  probe: allOf(
    ...TABLES.map((t) => rowCount(`basemap.${t}`, `SELECT count(*)::text AS n FROM basemap.${t}`)),
    wmsAnswers('basemap', '108.0,12.5,108.2,12.7')
  ),
});
