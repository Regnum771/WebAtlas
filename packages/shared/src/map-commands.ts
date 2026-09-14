/**
 * Commands that mutate the map view. This is the single contract shared by the
 * UI (buttons, search results) and the assistant's tool layer — both emit these,
 * and `features/map/model/mapCommands.ts` is the only code that executes them.
 *
 * Hand-written validation, no Zod: this module is imported by the browser bundle
 * and must not add a validator dependency to it.
 */
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from './index.js';
import { REGION_PROVINCE_CODES } from './region.js';
// Imported directly from layer-attributes.js, not via index.js: index.js itself
// re-exports this module, and routing through it would make LAYER_STATE_IDS'
// top-level initialization depend on module-cycle load order.
import { LAYER_ATTRIBUTE_MAP } from './layer-attributes.js';

export const MAP_COMMAND_KINDS = [
  'zoomToRegion',
  'zoomToFeature',
  'zoomTo',
  'resetView',
  'setLayerVisible',
  'setLayerOpacity',
  'setBasemap',
  'highlightFeatures',
  'clearHighlights',
] as const;

export type MapCommandKind = (typeof MAP_COMMAND_KINDS)[number];

export const BASEMAP_TYPES = ['street', 'satellite', 'dem'] as const;
export type BasemapName = (typeof BASEMAP_TYPES)[number];

/**
 * The two client-only administrative boundary layers: not editable data (no
 * EditableLayerKey/LAYER_ATTRIBUTE_MAP entry), but real rows in the layers
 * panel and real `layersState` ids in `MapModel`. Defined once here so
 * `layerDisplay.ts` (web) and `LAYER_STATE_IDS` below both read the same two
 * strings instead of each hand-typing them — see layer-attributes' terrain/dem
 * and legend-colour drift for what happens when a list like this gets copied.
 */
export const ADMIN_BOUNDARY_LAYER_STATE_IDS = ['layer_provinces_2026', 'layer_wards_2026'] as const;

/**
 * Basemap context layers: raster tiles served from GeoServer (OpenStreetMap data,
 * ODbL), each its own layer group with its own tile cache so they toggle
 * independently. Not editable data, but real rows in the layers panel and real
 * `layersState` ids — and deliberately valid command targets, so an assistant can
 * be asked to turn the roads off.
 */
export const BASEMAP_CONTEXT_LAYER_STATE_IDS = [
  'layer_bm_roads',
  'layer_bm_railways',
  'layer_bm_water',
  'layer_bm_landuse',
] as const;

/**
 * Every valid `layerStateId`: the 8 editable layers' ids (derived from
 * LAYER_ATTRIBUTE_MAP, not hand-copied), the 2 admin-boundary ids, and the 4
 * basemap context ids above.
 */
export const LAYER_STATE_IDS: readonly string[] = [
  ...Object.values(LAYER_ATTRIBUTE_MAP).map((info) => info.layerStateId),
  ...ADMIN_BOUNDARY_LAYER_STATE_IDS,
  ...BASEMAP_CONTEXT_LAYER_STATE_IDS,
];

function isLayerStateId(value: unknown): value is string {
  return typeof value === 'string' && LAYER_STATE_IDS.includes(value);
}

/**
 * A point the assistant wants drawn on the map. Coordinates, not feature ids:
 * every data tool already returns lonLat for the rows it reports, so the browser
 * needs no second lookup and the executor needs no WFS access.
 */
export interface HighlightPoint {
  lonLat: [number, number];
  label?: string;
}

/** Cap on one highlight command. Beyond this the map is noise, and a runaway
 *  tool result would push an unbounded payload through the route. */
export const MAX_HIGHLIGHT_POINTS = 50;

export type MapCommand =
  | { kind: 'zoomToRegion'; provinceCode: string }
  | { kind: 'zoomToFeature'; layerKey: EditableLayerKey; featureId: string; lonLat: [number, number] }
  | { kind: 'zoomTo'; zoom: number }
  // Whole working region (all 6 provinces), not any single province — see
  // features/map/model/zoomScale.ts INITIAL_CENTER_4326/INITIAL_ZOOM, the same
  // view the app opens on. zoomToRegion always targets one provinceCode, so it
  // cannot express "back to the whole region".
  | { kind: 'resetView' }
  | { kind: 'setLayerVisible'; layerStateId: string; visible: boolean }
  | { kind: 'setLayerOpacity'; layerStateId: string; opacity: number }
  | { kind: 'setBasemap'; basemap: BasemapName }
  | { kind: 'highlightFeatures'; points: HighlightPoint[] }
  | { kind: 'clearHighlights' };

function isLonLat(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function isLayerKey(value: unknown): value is EditableLayerKey {
  return typeof value === 'string' && (EDITABLE_LAYER_KEYS as readonly string[]).includes(value);
}

/**
 * Runtime guard. The API validates assistant-produced commands with this before
 * sending them to the browser, so an out-of-region province code, an unknown
 * layer key (zoomToFeature), or an unknown layerStateId (setLayerVisible,
 * setLayerOpacity) never reaches the map.
 */
export function isMapCommand(value: unknown): value is MapCommand {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;

  switch (c.kind) {
    case 'zoomToRegion':
      return (
        typeof c.provinceCode === 'string' &&
        (REGION_PROVINCE_CODES as readonly string[]).includes(c.provinceCode)
      );
    case 'zoomToFeature':
      return isLayerKey(c.layerKey) && typeof c.featureId === 'string' && isLonLat(c.lonLat);
    case 'zoomTo':
      return typeof c.zoom === 'number' && Number.isFinite(c.zoom);
    case 'resetView':
      return true;
    case 'setLayerVisible':
      return isLayerStateId(c.layerStateId) && typeof c.visible === 'boolean';
    case 'setLayerOpacity':
      return (
        isLayerStateId(c.layerStateId) &&
        typeof c.opacity === 'number' &&
        c.opacity >= 0 &&
        c.opacity <= 1
      );
    case 'setBasemap':
      return typeof c.basemap === 'string' && (BASEMAP_TYPES as readonly string[]).includes(c.basemap);
    case 'highlightFeatures':
      return (
        Array.isArray(c.points) &&
        c.points.length > 0 &&
        c.points.length <= MAX_HIGHLIGHT_POINTS &&
        c.points.every((p) => {
          if (typeof p !== 'object' || p === null) return false;
          const point = p as Record<string, unknown>;
          if (!isLonLat(point.lonLat)) return false;
          return point.label === undefined || typeof point.label === 'string';
        })
      );
    case 'clearHighlights':
      return true;
    default:
      return false;
  }
}
