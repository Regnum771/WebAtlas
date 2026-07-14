/** Geometry type per editable layer — matches the water.* migration (INV-4). */
export const LAYER_GEOMETRY = {
    dams: 'Point',
    rivers: 'MultiLineString',
    stations: 'Point',
    flood_zones: 'MultiPolygon',
    drought_points: 'Point',
    saltwater_intrusion: 'Point',
    flood_generation: 'MultiPolygon',
};
