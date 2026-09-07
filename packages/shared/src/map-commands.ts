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

export const MAP_COMMAND_KINDS = [
  'zoomToRegion',
  'zoomToFeature',
  'zoomTo',
  'setLayerVisible',
  'setLayerOpacity',
  'setBasemap',
] as const;

export type MapCommandKind = (typeof MAP_COMMAND_KINDS)[number];

export const BASEMAP_TYPES = ['street', 'satellite', 'dem'] as const;
export type BasemapName = (typeof BASEMAP_TYPES)[number];

export type MapCommand =
  | { kind: 'zoomToRegion'; provinceCode: string }
  | { kind: 'zoomToFeature'; layerKey: EditableLayerKey; featureId: string; lonLat: [number, number] }
  | { kind: 'zoomTo'; zoom: number }
  | { kind: 'setLayerVisible'; layerStateId: string; visible: boolean }
  | { kind: 'setLayerOpacity'; layerStateId: string; opacity: number }
  | { kind: 'setBasemap'; basemap: BasemapName };

// NOTE: a `highlightFeatures` variant was deliberately left out. Nothing in this
// plan highlights anything; Plan B adds it with a real highlight source and tests
// when the assistant needs it.

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
 * sending them to the browser, so an out-of-region province code or an unknown
 * layer key never reaches the map.
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
    case 'setLayerVisible':
      return typeof c.layerStateId === 'string' && typeof c.visible === 'boolean';
    case 'setLayerOpacity':
      return (
        typeof c.layerStateId === 'string' &&
        typeof c.opacity === 'number' &&
        c.opacity >= 0 &&
        c.opacity <= 1
      );
    case 'setBasemap':
      return typeof c.basemap === 'string' && (BASEMAP_TYPES as readonly string[]).includes(c.basemap);
    default:
      return false;
  }
}
