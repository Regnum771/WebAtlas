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
export declare const LAYER_PALETTE: Record<string, LayerPaletteEntry>;
