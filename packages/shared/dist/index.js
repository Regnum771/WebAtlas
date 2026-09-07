/**
 * Canonical keys for the editable thematic layers.
 * Single source of truth for layer identity across API registry,
 * GeoServer publication, and the frontend (INV-4).
 */
export const EDITABLE_LAYER_KEYS = [
    'dams',
    'rivers',
    'lakes',
    'stations',
    'flood_zones',
    'drought_points',
    'saltwater_intrusion',
    'flood_generation',
];
// Đuôi .js bắt buộc cho ESM thuần: package này là "type": "module" và resolve qua
// dist/, nên `node` từ chối import không có đuôi (Vite/Vitest thì tự suy ra được).
// Không có đuôi thì script .mjs chạy bằng node sẽ vỡ với ERR_MODULE_NOT_FOUND.
export { LAYER_GEOMETRY } from './layer-geometry.js';
export * from './layer-attributes.js';
export * from './feature-properties.js';
export * from './dam-status.js';
export * from './region.js';
export * from './osm-water.js';
export * from './map-commands.js';
export * from './layer-palette.js';
export * from './legend.js';
