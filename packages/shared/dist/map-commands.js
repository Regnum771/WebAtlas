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
export const MAP_COMMAND_KINDS = [
    'zoomToRegion',
    'zoomToFeature',
    'setLayerVisible',
    'setLayerOpacity',
    'setBasemap',
];
export const BASEMAP_TYPES = ['street', 'satellite', 'dem'];
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
 * sending them to the browser, so an out-of-region province code or an unknown
 * layer key never reaches the map.
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
        case 'setLayerVisible':
            return typeof c.layerStateId === 'string' && typeof c.visible === 'boolean';
        case 'setLayerOpacity':
            return (typeof c.layerStateId === 'string' &&
                typeof c.opacity === 'number' &&
                c.opacity >= 0 &&
                c.opacity <= 1);
        case 'setBasemap':
            return typeof c.basemap === 'string' && BASEMAP_TYPES.includes(c.basemap);
        default:
            return false;
    }
}
