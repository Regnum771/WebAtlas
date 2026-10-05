/**
 * Zoom thresholds and the load gate for heavy static layers.
 *
 * OpenLayers' `setMinZoom` only stops DRAWING; a source still loads its data whatever
 * the zoom. For a heavy layer the gate has to sit at the SOURCE: load only once the
 * user actually zooms to where the layer shows.
 *
 * `createOneShotLoadGate` — a static file layer. Loads in full EXACTLY ONCE when the
 * threshold is crossed. (The water layers and the wards are API vector tiles now, which only
 * request what is in view and nothing while hidden, so they need no gate; no layer uses it today.)
 */

/** Zoom threshold from which ward boundaries draw — see recomputeVisibility() in MapModel. */
export const WARDS_MIN_ZOOM = 10.0;

/**
 * Zoom threshold from which rivers and lakes draw (the river overview covers below it).
 *
 * Why 8.5: the work area is 374 km wide but 988 km TALL, so no zoom level shows the
 * whole area at a detail where the full river network is readable. Below 8.5 the
 * region's river network is too dense to read anyway, so nothing is lost.
 */
export const WATER_MIN_ZOOM = 8.5;

/**
 * One-shot gate: calls `load()` the first time zoom >= `minZoom`, never again after.
 * Returns a function taking the zoom level, called on every `moveend`.
 */
export function createOneShotLoadGate(minZoom: number, load: () => void): (zoom: number) => void {
  let loaded = false;
  return (zoom: number) => {
    if (loaded) return;
    if (typeof zoom !== 'number' || Number.isNaN(zoom)) return;
    if (zoom < minZoom) return;
    loaded = true;
    load();
  };
}
