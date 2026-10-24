import { HIGHLIGHT_LAYER_ID, RESULTS_LAYER_ID } from './highlightLayer';
import { ROI_LAYER_ID } from './roiLayer';

/** Transient overlay layers: never a click target for the popup, never a snap target. */
export const OVERLAY_LAYER_IDS: ReadonlySet<string> = new Set([ROI_LAYER_ID, RESULTS_LAYER_ID, HIGHLIGHT_LAYER_ID]);

/** The property every personal-map layer carries (features/my-maps/model/personalLayers.ts). */
export const PERSONAL_LAYER_PROP = 'personal';

/**
 * Pixels around a click within which a personal feature counts as clicked. The personal card and
 * the official popup both decide "a personal feature was clicked" with it, so they never both open.
 */
export const PERSONAL_HIT_TOLERANCE = 3;

/**
 * The selected feature's ring (features/my-maps/model/personalLayers.ts). Marked personal, so it is
 * never official data, but it is no personal feature: a click on its halo alone is nobody's card.
 */
export const RING_LAYER_ID = 'ws-ring';

/** A layer holding personal features a click can open: a personal layer, not the selection ring. */
export function isPersonalFeatureLayer(layer: { get(key: string): unknown } | null | undefined): boolean {
  return isPersonalLayer(layer) && layer?.get('id') !== RING_LAYER_ID;
}

/**
 * A layer of a personal map: never a target of the official popup or the official edit
 * selection, whatever its id. Typed structurally so a hit-test callback's layer fits as is.
 */
export function isPersonalLayer(layer: { get(key: string): unknown } | null | undefined): boolean {
  return layer?.get(PERSONAL_LAYER_PROP) === true;
}
