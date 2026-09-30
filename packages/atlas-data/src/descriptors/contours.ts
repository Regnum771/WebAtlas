import { defineDataset } from '../schema';
import { allOf, rowCount, wmsAnswers } from '../probes';

/**
 * Must equal CONTOUR_INTERVALS in packages/shared/src/contours.ts. atlas-data does not depend on
 * @webatlas/shared (no new runtime dependencies), so descriptors.test.ts pins the two together.
 */
export const CONTOUR_INTERVALS_M = [250, 100, 50] as const;

/**
 * Runbook step 8: contour lines from the DEM, then their styles and GeoServer layers. The publish
 * script ensures the basemap_pg store itself, so this depends on the DEM only — a dependsOn on the
 * basemap would wrongly make contours inherit OpenStreetMap's ODbL.
 */
export const contours = defineDataset({
  id: 'contours',
  kind: 'derived',
  dependsOn: ['dem'],
  lineage: {
    statement: 'Đường đồng mức 250/100/50 m sinh từ DEM bằng ST_Contour, phục vụ dưới dạng lớp WMS có nhãn.',
    licence: 'CC-BY-NC-SA-4.0',
    sources: [],
  },
  stages: [
    {
      type: 'run',
      in: 'host',
      argv: ['run', 'contours:generate', '-w', '@webatlas/api'],
      produces: 'basemap.contours',
      promoteTo: 'sql',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['python3', 'packages/atlas-data/tools/contours/styles.py'],
      produces: 'GeoServer styles contours_plain, contours_labelled',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['bash', 'packages/atlas-data/tools/contours/publish-contours.sh'],
      produces: 'GeoServer layers webatlas:contours_{250,100,50}',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
  ],
  probe: allOf(
    ...CONTOUR_INTERVALS_M.map((m) =>
      rowCount(`contours ${m} m`, `SELECT count(*)::text AS n FROM basemap.contours WHERE interval_m = ${m}`)
    ),
    wmsAnswers('contours_50', '108.0,12.5,108.2,12.7')
  ),
});
