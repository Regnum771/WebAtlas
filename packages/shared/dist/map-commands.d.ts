/**
 * Commands that mutate the map view. This is the single contract shared by the
 * UI (buttons, search results) and the assistant's tool layer — both emit these,
 * and `features/map/model/mapCommands.ts` is the only code that executes them.
 *
 * Hand-written validation, no Zod: this module is imported by the browser bundle
 * and must not add a validator dependency to it.
 */
import { type EditableLayerKey } from './index.js';
export declare const MAP_COMMAND_KINDS: readonly ["zoomToRegion", "zoomToFeature", "zoomTo", "resetView", "setLayerVisible", "setLayerOpacity", "setBasemap"];
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
 * Every valid `layerStateId`: the 8 editable layers' ids (derived from
 * LAYER_ATTRIBUTE_MAP, not hand-copied) plus the 2 admin-boundary ids above.
 */
export declare const LAYER_STATE_IDS: readonly string[];
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
};
/**
 * Runtime guard. The API validates assistant-produced commands with this before
 * sending them to the browser, so an out-of-region province code, an unknown
 * layer key (zoomToFeature), or an unknown layerStateId (setLayerVisible,
 * setLayerOpacity) never reaches the map.
 */
export declare function isMapCommand(value: unknown): value is MapCommand;
