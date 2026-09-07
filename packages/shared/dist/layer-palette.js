export const LAYER_PALETTE = {
    layer_rivers: { color: '#38bdf8' },
    layer_lakes: { color: '#38bdf8', stroke: '#0284c7' },
    layer_stations: { color: '#10b981' },
    layer_flood: { color: '#ef4444' },
    layer_drought_survey: { color: '#b45309' },
    layer_saltwater_intrusion: { color: '#7c3aed' },
    layer_flood_generation: { color: '#4f46e5' },
    // Per-feature fill (rotating pastel palette / hashed hue) carries no single
    // meaningful swatch; this is the constant boundary stroke color instead.
    layer_provinces_2026: { color: '#4338ca' },
    layer_wards_2026: { color: '#6b7280' },
    // Basemap context layers (raster, rendered by GeoServer from OSM data).
    // SOURCE OF TRUTH for the SLD colours too: apps/api/scripts/basemap/styles.py
    // parses these values out of this file rather than keeping its own copy — a
    // second hand-typed list is what caused the terrain/dem and legend-colour
    // drift this palette exists to prevent, and a Python/TypeScript split would
    // put that copy where no TS test could ever catch it.
    layer_bm_roads: { color: '#ffffff', stroke: '#e2e2e2' },
    layer_bm_railways: { color: '#d0d0d0' },
    layer_bm_water: { color: '#d3e3f0', stroke: '#b9d3e6' },
    layer_bm_landuse: { color: '#e8ebe4', secondary: '#ebebeb' },
};
