/**
 * Commands that mutate the map view. This is the single contract shared by the
 * UI (buttons, search results) and the assistant's tool layer — both emit these,
 * and `features/map/model/mapCommands.ts` is the only code that executes them.
 *
 * Hand-written validation, no Zod: this module is imported by the browser bundle
 * and must not add a validator dependency to it.
 */
import { EDITABLE_LAYER_KEYS } from './index.js';
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
];
export const BASEMAP_TYPES = ['street', 'satellite', 'dem'];
/**
 * The two client-only administrative boundary layers: not editable data (no
 * EditableLayerKey/LAYER_ATTRIBUTE_MAP entry), but real rows in the layers
 * panel and real `layersState` ids in `MapModel`. Defined once here so
 * `layerDisplay.ts` (web) and `LAYER_STATE_IDS` below both read the same two
 * strings instead of each hand-typing them — see layer-attributes' terrain/dem
 * and legend-colour drift for what happens when a list like this gets copied.
 */
export const ADMIN_BOUNDARY_LAYER_STATE_IDS = ['layer_provinces_2026', 'layer_wards_2026'];
/**
 * Every valid `layerStateId`: the 8 editable layers' ids (derived from
 * LAYER_ATTRIBUTE_MAP, not hand-copied) plus the 2 admin-boundary ids above.
 */
export const LAYER_STATE_IDS = [
    ...Object.values(LAYER_ATTRIBUTE_MAP).map((info) => info.layerStateId),
    ...ADMIN_BOUNDARY_LAYER_STATE_IDS,
];
function isLayerStateId(value) {
    return typeof value === 'string' && LAYER_STATE_IDS.includes(value);
}
// NOTE: a `highlightFeatures` variant was deliberately left out. Nothing in this
// plan highlights anything; Plan B adds it with a real highlight source and tests
// when the assistant needs it.
function isLonLat(value) {
    return (Array.isArray(value) &&
        value.length === 2 &&
        value.every((n) => typeof n === 'number' && Number.isFinite(n)));
}
function isLayerKey(value) {
    return typeof value === 'string' && EDITABLE_LAYER_KEYS.includes(value);
}
/**
 * Runtime guard. The API validates assistant-produced commands with this before
 * sending them to the browser, so an out-of-region province code, an unknown
 * layer key (zoomToFeature), or an unknown layerStateId (setLayerVisible,
 * setLayerOpacity) never reaches the map.
 */
export function isMapCommand(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const c = value;
    switch (c.kind) {
        case 'zoomToRegion':
            return (typeof c.provinceCode === 'string' &&
                REGION_PROVINCE_CODES.includes(c.provinceCode));
        case 'zoomToFeature':
            return isLayerKey(c.layerKey) && typeof c.featureId === 'string' && isLonLat(c.lonLat);
        case 'zoomTo':
            return typeof c.zoom === 'number' && Number.isFinite(c.zoom);
        case 'resetView':
            return true;
        case 'setLayerVisible':
            return isLayerStateId(c.layerStateId) && typeof c.visible === 'boolean';
        case 'setLayerOpacity':
            return (isLayerStateId(c.layerStateId) &&
                typeof c.opacity === 'number' &&
                c.opacity >= 0 &&
                c.opacity <= 1);
        case 'setBasemap':
            return typeof c.basemap === 'string' && BASEMAP_TYPES.includes(c.basemap);
        default:
            return false;
    }
}
