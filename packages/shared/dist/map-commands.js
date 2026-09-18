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
import { isGeoJsonGeometry, countVertices } from './geometry.js';
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
    'showGeometries',
    'proposeFeatureEdit',
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
];
/**
 * Lớp địa hình dẫn xuất từ DEM. Tách khỏi BASEMAP_CONTEXT_* vì đây không phải ngữ cảnh
 * nền OSM: nó sinh ra từ basemap.dem_region, và hàng xóm tương lai của nó là lớp đổ bóng
 * địa hình, không phải đường sá.
 *
 * Là mục tiêu lệnh hợp lệ, nên trợ lý bật/tắt được khi người dùng yêu cầu.
 */
export const TERRAIN_LAYER_STATE_IDS = ['layer_contours'];
/**
 * Every valid `layerStateId`: the 8 editable layers' ids (derived from
 * LAYER_ATTRIBUTE_MAP, not hand-copied), the 2 admin-boundary ids, the 4
 * basemap context ids, and the terrain layer ids above.
 */
export const LAYER_STATE_IDS = [
    ...Object.values(LAYER_ATTRIBUTE_MAP).map((info) => info.layerStateId),
    ...ADMIN_BOUNDARY_LAYER_STATE_IDS,
    ...BASEMAP_CONTEXT_LAYER_STATE_IDS,
    ...TERRAIN_LAYER_STATE_IDS,
];
function isLayerStateId(value) {
    return typeof value === 'string' && LAYER_STATE_IDS.includes(value);
}
/** Cap on one highlight command. Beyond this the map is noise, and a runaway
 *  tool result would push an unbounded payload through the route. */
export const MAX_HIGHLIGHT_POINTS = 50;
/** How a drawn result reads on the map: a feature the answer points at, a shape
 *  the user supplied, or a shape an analysis produced. */
export const RESULT_ROLES = ['highlight', 'input', 'result'];
export const MAX_RESULT_ITEMS = 200;
export const MAX_RESULT_VERTICES = 20_000;
export const MAX_SOURCE_DOCUMENT_LENGTH = 500;
export const MAX_SOURCE_PROVIDER_LENGTH = 200;
/** Keeps the leading items that fit both caps. The server calls this before
 *  building a command so it never emits one its own validator rejects. */
export function capResultItems(items) {
    const kept = [];
    let vertices = 0;
    for (const item of items) {
        const n = countVertices(item.geometry);
        if (kept.length >= MAX_RESULT_ITEMS || vertices + n > MAX_RESULT_VERTICES) {
            return { items: kept, truncated: true };
        }
        kept.push(item);
        vertices += n;
    }
    return { items: kept, truncated: false };
}
/** Columns an update may touch: the layer's attributes minus `external_id`, which
 *  is identity, not data (the API's attributeSchema excludes it too). */
export function editableColumns(layerKey) {
    return Object.keys(LAYER_ATTRIBUTE_MAP[layerKey].attributes).filter((c) => c !== 'external_id');
}
function isLonLat(value) {
    return (Array.isArray(value) &&
        value.length === 2 &&
        value.every((n) => typeof n === 'number' && Number.isFinite(n)));
}
function isLayerKey(value) {
    return typeof value === 'string' && EDITABLE_LAYER_KEYS.includes(value);
}
function isResultGeometry(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const r = value;
    return (isGeoJsonGeometry(r.geometry) &&
        typeof r.role === 'string' &&
        RESULT_ROLES.includes(r.role) &&
        (r.label === undefined || typeof r.label === 'string') &&
        (r.layerKey === undefined || isLayerKey(r.layerKey)) &&
        (r.featureId === undefined || typeof r.featureId === 'string'));
}
function isValueRecord(value, allowed) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    return Object.entries(value).every(([k, v]) => allowed.includes(k) && (v === null || typeof v === 'string'));
}
function isOptionalText(value, max) {
    return value === undefined || (typeof value === 'string' && value.length <= max);
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
        case 'highlightFeatures':
            return (Array.isArray(c.points) &&
                c.points.length > 0 &&
                c.points.length <= MAX_HIGHLIGHT_POINTS &&
                c.points.every((p) => {
                    if (typeof p !== 'object' || p === null)
                        return false;
                    const point = p;
                    if (!isLonLat(point.lonLat))
                        return false;
                    return point.label === undefined || typeof point.label === 'string';
                }));
        case 'clearHighlights':
            return true;
        case 'showGeometries': {
            if (!Array.isArray(c.items) || c.items.length === 0 || c.items.length > MAX_RESULT_ITEMS)
                return false;
            if (!c.items.every(isResultGeometry))
                return false;
            const vertices = c.items.reduce((n, i) => n + countVertices(i.geometry), 0);
            return vertices <= MAX_RESULT_VERTICES && (c.fit === undefined || typeof c.fit === 'boolean');
        }
        case 'proposeFeatureEdit': {
            if (!isLayerKey(c.layerKey) || typeof c.featureId !== 'string')
                return false;
            const allowed = editableColumns(c.layerKey);
            return (isValueRecord(c.current, allowed) &&
                isValueRecord(c.proposed, allowed) &&
                Object.keys(c.proposed).length > 0 &&
                (c.name === undefined || typeof c.name === 'string') &&
                isOptionalText(c.sourceDocument, MAX_SOURCE_DOCUMENT_LENGTH) &&
                isOptionalText(c.sourceProvider, MAX_SOURCE_PROVIDER_LENGTH));
        }
        default:
            return false;
    }
}
