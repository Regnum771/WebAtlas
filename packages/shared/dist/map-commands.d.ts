/**
 * Commands that mutate the map view. This is the single contract shared by the
 * UI (buttons, search results) and the assistant's tool layer — both emit these,
 * and `features/map/model/mapCommands.ts` is the only code that executes them.
 *
 * Hand-written validation, no Zod: this module is imported by the browser bundle
 * and must not add a validator dependency to it.
 */
import { type EditableLayerKey } from './index.js';
export declare const MAP_COMMAND_KINDS: readonly ["zoomToRegion", "zoomToFeature", "setLayerVisible", "setLayerOpacity", "setBasemap"];
export type MapCommandKind = (typeof MAP_COMMAND_KINDS)[number];
export declare const BASEMAP_TYPES: readonly ["street", "satellite", "dem"];
export type BasemapName = (typeof BASEMAP_TYPES)[number];
export type MapCommand = {
    kind: 'zoomToRegion';
    provinceCode: string;
} | {
    kind: 'zoomToFeature';
    layerKey: EditableLayerKey;
    featureId: string;
    lonLat: [number, number];
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
 * sending them to the browser, so an out-of-region province code or an unknown
 * layer key never reaches the map.
 */
export declare function isMapCommand(value: unknown): value is MapCommand;
