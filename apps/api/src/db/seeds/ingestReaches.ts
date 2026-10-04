import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import type { SeedLayer } from './registry';
import { RIVER_REACH_COLUMNS } from '@webatlas/shared';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * HydroRIVERS reaches as LEVEL-2 rows of water.rivers.
 *
 * A reach row IS the network edge (spec §6): its geometry is the span and
 * flows_into_external_id is its single outgoing adjacency, so upstream and
 * downstream are WITH RECURSIVE walks over one column and there is no edge table.
 *
 * MAIN_RIV is present in the seed file but deliberately NOT loaded: no column in the
 * spec holds it, and overloading `code` (which carries the OSM waterway type at level 3)
 * would make a column's meaning depend on the row's level. It stays in the file because
 * regenerating the file needs the 90 MB upstream shapefile again, and a future
 * basin-level entity would want it.
 */
export const REACHES_LAYER: SeedLayer = {
  table: 'rivers',
  file: resolvePath(here, '../../../../../packages/atlas-data/data/seeds/hydrorivers-region.geojson'),
  source: 'HydroRIVERS v10',
  multiLine: true,
  columns: RIVER_REACH_COLUMNS,
};
