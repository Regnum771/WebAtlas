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
    // SOURCE OF TRUTH for the SLD colours too: packages/atlas-data/tools/basemap/styles.py
    // parses these values out of this file rather than keeping its own copy — a
    // second hand-typed list is what caused the terrain/dem and legend-colour
    // drift this palette exists to prevent, and a Python/TypeScript split would
    // put that copy where no TS test could ever catch it.
    // Standard OpenStreetMap Carto palette: pale paper land, cream roads, cyan water,
    // green landuse, and muted grey/railway tones.
    layer_bm_roads: { color: '#f7f1d0', stroke: '#9e9e9e' },
    layer_bm_railways: { color: '#b3b2a9' },
    layer_bm_water: { color: '#b5d0d0', stroke: '#7aa9b5' },
    layer_bm_landuse: { color: '#c8d7ab', secondary: '#e7e7e7' },
};
