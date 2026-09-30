import { defineDataset } from '../schema';
import { elevationBetween } from '../probes';

/**
 * Runbook step 7: FABDEM, clipped to the working region's mainland and loaded as PostGIS raster.
 * Non-commercial licence — it propagates to every derived dataset (contours).
 */
export const dem = defineDataset({
  id: 'dem',
  kind: 'raster',
  lineage: {
    statement:
      'Mô hình độ cao bề mặt đất trần FABDEM, cắt theo phần đất liền của sáu tỉnh, nạp vào basemap.dem_region.',
    licence: 'CC-BY-NC-SA-4.0',
    sources: [
      {
        citation:
          'FABDEM V1-2, University of Bristol (Hawker et al. 2022), fetched per tile from the Fondazione LINKS mirror; ' +
          'produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018',
        licence: 'CC-BY-NC-SA-4.0',
        uri: 'https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn',
        resolution: '1 arc-second (~30 m)',
      },
    ],
  },
  stages: [
    {
      type: 'run',
      in: 'tools',
      argv: ['python3', 'packages/atlas-data/tools/prep_dem.py', '--mainland', '--out', 'packages/atlas-data/data/cache/dem'],
      produces: 'packages/atlas-data/data/cache/dem/clipped/*.tif',
      promoteTo: 'fetch-cog',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['bash', 'packages/atlas-data/tools/load-dem.sh', 'packages/atlas-data/data/cache/dem/clipped'],
      produces: 'basemap.dem_region',
      promoteTo: 'load-raster',
      promoteBy: '2027-06-30',
    },
  ],
  // Buôn Ma Thuột, measured ~472 m on the FABDEM load.
  probe: elevationBetween('Buôn Ma Thuột', 108.0447, 12.6797, 440, 500),
});
