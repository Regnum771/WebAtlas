/**
 * Canonical keys for the editable thematic layers.
 * Single source of truth for layer identity across API registry,
 * GeoServer publication, and the frontend (INV-4).
 */
export const EDITABLE_LAYER_KEYS = [
  'dams',
  'rivers',
  'stations',
  'flood_zones',
  'drought_points',
  'saltwater_intrusion',
  'flood_generation',
] as const;

export type EditableLayerKey = (typeof EDITABLE_LAYER_KEYS)[number];

export { LAYER_GEOMETRY, type OgcGeometryType } from './layer-geometry';
export * from './layer-attributes';
export * from './feature-properties';
export * from './attribute-schema';
export * from './dam-status';
export * from './map-view';
