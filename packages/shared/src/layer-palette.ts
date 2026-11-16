/** Layer identity colors, shared so the legend swatches (legend.ts) and the map
 *  styles (apps/web/src/features/map/model/styles.ts) read from one place and
 *  cannot silently diverge the way they did before (legend hand-typed its own
 *  copies of colors the map styles defined separately).
 *
 *  Only the raw color values live here — dams already had this via
 *  DAM_STATUS_DISPLAY, this extends the same idea to the rest of the layers.
 *  Opacity variants and actual OpenLayers Style/Fill/Stroke objects are still
 *  built locally in styles.ts; `color`/`stroke` here are plain '#rrggbb' hex so
 *  styles.ts can derive an rgba() from them where the map uses a translucent
 *  fill. */
export interface LayerPaletteEntry {
  /** Primary/identifying color: the layer's dominant hue on the map. */
  color: string;
  /** Secondary color, e.g. a distinct outline, when the map style uses one
   *  that differs from `color` (not just a decorative white/black border). */
  stroke?: string;
  /** A second *fill* — not an outline — for layers that legitimately render two
   *  categories under one panel row (basemap landuse: vegetation vs built-up).
   *  Kept optional so nothing else has to care. */
  secondary?: string;
}

export const LAYER_PALETTE: Record<string, LayerPaletteEntry> = {
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
