import { ADMIN_BOUNDARY_LAYER_STATE_IDS, EDITABLE_LAYER_KEYS, LAYER_ATTRIBUTE_MAP, TERRAIN_LAYER_STATE_IDS } from '@webatlas/shared';

const [PROVINCES, WARDS] = ADMIN_BOUNDARY_LAYER_STATE_IDS;
const [CONTOURS] = TERRAIN_LAYER_STATE_IDS;

/**
 * layersState id -> dictionary key, for the rows that have a dictionary entry.
 * The editable layers come from the shared attribute map; the rest are verified rows:
 * layer_bm_water is the GeoServer group `bm_water`, which is exactly basemap.water_region.
 * There is no DEM row in the layers panel, so none is listed.
 */
export const LAYER_DICTIONARY_KEYS: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(EDITABLE_LAYER_KEYS.map((key) => [LAYER_ATTRIBUTE_MAP[key].layerStateId, key])),
  [PROVINCES]: 'provinces',
  [WARDS]: 'wards',
  [CONTOURS]: 'contours',
  layer_bm_water: 'osm_water',
});

export function dictionaryKeyFor(layerId: string): string | null {
  return LAYER_DICTIONARY_KEYS[layerId] ?? null;
}
