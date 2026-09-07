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
