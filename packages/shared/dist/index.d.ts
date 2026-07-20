/**
 * Canonical keys for the editable thematic layers.
 * Single source of truth for layer identity across API registry,
 * GeoServer publication, and the frontend (INV-4).
 */
export declare const EDITABLE_LAYER_KEYS: readonly ["dams", "rivers", "stations", "flood_zones", "drought_points", "saltwater_intrusion", "flood_generation"];
export type EditableLayerKey = (typeof EDITABLE_LAYER_KEYS)[number];
export { LAYER_GEOMETRY, type OgcGeometryType } from './layer-geometry';
export * from './layer-attributes';
export * from './feature-properties';
export * from './attribute-schema';
export * from './dam-status';
