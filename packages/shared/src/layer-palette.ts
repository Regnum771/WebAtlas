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
};
