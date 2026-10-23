import { HIGHLIGHT_LAYER_ID, RESULTS_LAYER_ID } from './highlightLayer';
import { ROI_LAYER_ID } from './roiLayer';

/** Transient overlay layers: never a click target for the popup, never a snap target. */
export const OVERLAY_LAYER_IDS: ReadonlySet<string> = new Set([ROI_LAYER_ID, RESULTS_LAYER_ID, HIGHLIGHT_LAYER_ID]);

/** The property every personal-map layer carries (features/my-maps/model/personalLayers.ts). */
export const PERSONAL_LAYER_PROP = 'personal';

/**
 * A layer of a personal map: never a target of the official popup or the official edit
 * selection, whatever its id. Typed structurally so a hit-test callback's layer fits as is.
 */
export function isPersonalLayer(layer: { get(key: string): unknown } | null | undefined): boolean {
  return layer?.get(PERSONAL_LAYER_PROP) === true;
}
