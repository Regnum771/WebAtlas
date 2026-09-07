/**
 * Canonical keys for the editable thematic layers.
 * Single source of truth for layer identity across API registry,
 * GeoServer publication, and the frontend (INV-4).
 */
export declare const EDITABLE_LAYER_KEYS: readonly ["dams", "rivers", "lakes", "stations", "flood_zones", "drought_points", "saltwater_intrusion", "flood_generation"];
export type EditableLayerKey = (typeof EDITABLE_LAYER_KEYS)[number];
export { LAYER_GEOMETRY, type OgcGeometryType } from './layer-geometry.js';
export * from './layer-attributes.js';
export * from './feature-properties.js';
export * from './dam-status.js';
export * from './region.js';
export * from './osm-water.js';
export * from './map-commands.js';
