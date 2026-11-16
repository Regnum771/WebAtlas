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
    // Indigo, the provinces' hue: the old grey dash read as a footpath on the OSM basemap.
    layer_wards_2026: { color: '#6366f1' },
    // Basemap context layers (raster, rendered by GeoServer from OSM data).
    // SOURCE OF TRUTH for the SLD colours too: packages/atlas-data/tools/basemap/styles.py
    // parses these values out of this file rather than keeping its own copy — a
    // second hand-typed list is what caused the terrain/dem and legend-colour
    // drift this palette exists to prevent, and a Python/TypeScript split would
    // put that copy where no TS test could ever catch it.
    // The standard OpenStreetMap map's (OSM Carto) colours. Roads: the primary road's fill and
    // casing, the one road swatch the legend shows (styles.py gives each class its own colour).
    // Water has no outline, as on OSM. Landuse: forest, and residential as the built-up grey.
    layer_bm_roads: { color: '#fcd6a4', stroke: '#a06b00' },
    layer_bm_railways: { color: '#707070' },
    layer_bm_water: { color: '#aad3df' },
    layer_bm_landuse: { color: '#add19e', secondary: '#e0dfdf' },
};
