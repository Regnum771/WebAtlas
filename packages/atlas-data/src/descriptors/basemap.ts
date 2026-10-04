import { defineDataset } from '../schema';
import { allOf, rowCount, wmsAnswers } from '../probes';

const TABLES = [
  'land_vn', 'roads_vn', 'railways_vn', 'places_vn', 'roads_region', 'places_region', 'landuse_region', 'water_region',
] as const;

/**
 * What publish-basemap.sh builds and apps/web's MapModel.ts requests: the land-only base and one
 * group per context layer. A test holds this list, the script and MapModel.ts together.
 */
export const LAYER_GROUPS = ['basemap', 'bm_landuse', 'bm_water', 'bm_railways', 'basemap_roads'] as const;

/**
 * The pinned Geofabrik extract (spec C-10). One dated file plus its sha256, so every clone gets
 * identical data and a changed file fails the fetch instead of silently changing the basemap.
 * Not `-latest`: on 2026-09-30 every `*-latest*` alias on download.geofabrik.de 301-looped to
 * itself (Task 12), and Geofabrik prunes dated files after a while (dailies after about a week,
 * the first-of-month files after about three months; only the 1 January files stay).
 *
 * So the pin is a first-of-month file, never a daily: 261001 should stay downloadable until about
 * early January 2027, when 270101 (kept for good) can replace it.
 *
 * Refreshing the basemap is therefore a deliberate bump: change DATE and SHA256 together, then
 * `npm run atlas:build`. If the pinned file 404s, bump it to a current dated file the same way.
 * Geofabrik publishes an .md5 next to the monthly .shp.zip files (none for dailies): check the
 * download against it, then compute its sha256.
 */
const DATE = '261001';
const SHA256 = '7ad4a29026ef32e5a47ea90f9ceb1544a82e8836d1899d7d3f9422a119a23efe';
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
      produces: 'GeoServer styles basemap_* (land included) assigned to the basemap layers',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['bash', 'packages/atlas-data/tools/basemap/publish-basemap.sh', 'group'],
      produces: 'GeoServer layer groups webatlas:{basemap,bm_landuse,bm_water,bm_railways,basemap_roads}, tile caches truncated',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
  ],
  // Every table load_basemap.py writes (each is loaded in one transaction, so a table that exists is
  // a whole one), then every layer group the web app requests from GWC: a fresh GeoServer that only
  // has some of them must not pass.
  probe: allOf(
    ...TABLES.map((t) => rowCount(`basemap.${t}`, `SELECT count(*)::text AS n FROM basemap.${t}`)),
    ...LAYER_GROUPS.map((g) => wmsAnswers(g, '108.0,12.5,108.2,12.7'))
  ),
});
