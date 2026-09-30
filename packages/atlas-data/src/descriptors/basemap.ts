import { defineDataset } from '../schema';
import { allOf, rowCount, wmsAnswers } from '../probes';

const ZIP = 'basemap/vietnam-latest-free.shp.zip';

/**
 * Runbook step 5: the self-hosted street basemap from the Geofabrik Vietnam extract (684 MB). The URL
 * is `latest`, so it is deliberately unpinned (spec C-10): the fetched hash is recorded in lineage,
 * and `--force basemap` refreshes it.
 */
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
    { type: 'fetch-http', url: 'https://download.geofabrik.de/asia/vietnam-latest-free.shp.zip', into: ZIP },
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
  probe: allOf(
    rowCount('basemap.roads_region', 'SELECT count(*)::text AS n FROM basemap.roads_region'),
    wmsAnswers('basemap', '108.0,12.5,108.2,12.7')
  ),
});
