import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import type { SeedLayer } from './registry';

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
  file: resolvePath(here, 'data/hydrorivers-region.geojson'),
  source: 'HydroRIVERS v10',
  multiLine: true,
  columns: (p) => ({
    external_id: `hyriv:${String(p.HYRIV_ID)}`,
    feature_level: 2,
    // HydroRIVERS writes 0 for a terminal reach -> NULL, meaning "end of the network".
    // A NEXT_DOWN that simply is not in this file (53 reaches leaving the region) keeps
    // its value: "the water goes somewhere we do not hold" is a different fact, and
    // collapsing both to NULL would hide it from the activation gates.
    flows_into_external_id: Number(p.NEXT_DOWN) === 0 ? null : `hyriv:${String(p.NEXT_DOWN)}`,
    // The TRUE Strahler order (ORD_STRA). Level 3 keeps the OSM waterway rank it has
    // always held -- the two are different measures and must not be compared.
    stream_order: p.ORD_STRA,
    length_m: Number(p.LENGTH_KM) * 1000,
    // HydroRIVERS has no names. Task 5 records the JOINED name on the link, never here.
    name: null,
  }),
};
