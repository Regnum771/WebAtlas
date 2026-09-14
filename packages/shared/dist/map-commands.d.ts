/**
 * Commands that mutate the map view. This is the single contract shared by the
 * UI (buttons, search results) and the assistant's tool layer — both emit these,
 * and `features/map/model/mapCommands.ts` is the only code that executes them.
 *
 * Hand-written validation, no Zod: this module is imported by the browser bundle
 * and must not add a validator dependency to it.
 */
import { type EditableLayerKey } from './index.js';
export declare const MAP_COMMAND_KINDS: readonly ["zoomToRegion", "zoomToFeature", "zoomTo", "resetView", "setLayerVisible", "setLayerOpacity", "setBasemap", "highlightFeatures", "clearHighlights"];
export type MapCommandKind = (typeof MAP_COMMAND_KINDS)[number];
export declare const BASEMAP_TYPES: readonly ["street", "satellite", "dem"];
export type BasemapName = (typeof BASEMAP_TYPES)[number];
/**
 * The two client-only administrative boundary layers: not editable data (no
 * EditableLayerKey/LAYER_ATTRIBUTE_MAP entry), but real rows in the layers
 * panel and real `layersState` ids in `MapModel`. Defined once here so
 * `layerDisplay.ts` (web) and `LAYER_STATE_IDS` below both read the same two
 * strings instead of each hand-typing them — see layer-attributes' terrain/dem
 * and legend-colour drift for what happens when a list like this gets copied.
 */
export declare const ADMIN_BOUNDARY_LAYER_STATE_IDS: readonly ["layer_provinces_2026", "layer_wards_2026"];
/**
 * Basemap context layers: raster tiles served from GeoServer (OpenStreetMap data,
 * ODbL), each its own layer group with its own tile cache so they toggle
 * independently. Not editable data, but real rows in the layers panel and real
 * `layersState` ids — and deliberately valid command targets, so an assistant can
 * be asked to turn the roads off.
 */
export declare const BASEMAP_CONTEXT_LAYER_STATE_IDS: readonly ["layer_bm_roads", "layer_bm_railways", "layer_bm_water", "layer_bm_landuse"];
/**
 * Every valid `layerStateId`: the 8 editable layers' ids (derived from
 * LAYER_ATTRIBUTE_MAP, not hand-copied), the 2 admin-boundary ids, and the 4
 * basemap context ids above.
 */
export declare const LAYER_STATE_IDS: readonly string[];
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
export declare const MAX_HIGHLIGHT_POINTS = 50;
export type MapCommand = {
    kind: 'zoomToRegion';
    provinceCode: string;
} | {
    kind: 'zoomToFeature';
    layerKey: EditableLayerKey;
    featureId: string;
    lonLat: [number, number];
} | {
    kind: 'zoomTo';
    zoom: number;
} | {
    kind: 'resetView';
} | {
    kind: 'setLayerVisible';
    layerStateId: string;
    visible: boolean;
} | {
    kind: 'setLayerOpacity';
    layerStateId: string;
    opacity: number;
} | {
    kind: 'setBasemap';
    basemap: BasemapName;
} | {
    kind: 'highlightFeatures';
    points: HighlightPoint[];
} | {
    kind: 'clearHighlights';
};
/**
 * Runtime guard. The API validates assistant-produced commands with this before
 * sending them to the browser, so an out-of-region province code, an unknown
 * layer key (zoomToFeature), or an unknown layerStateId (setLayerVisible,
 * setLayerOpacity) never reaches the map.
 */
export declare function isMapCommand(value: unknown): value is MapCommand;
