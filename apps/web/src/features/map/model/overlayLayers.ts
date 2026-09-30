import { HIGHLIGHT_LAYER_ID, RESULTS_LAYER_ID } from './highlightLayer';
import { ROI_LAYER_ID } from './roiLayer';

/** Transient overlay layers: never a click target for the popup, never a snap target. */
export const OVERLAY_LAYER_IDS: ReadonlySet<string> = new Set([ROI_LAYER_ID, RESULTS_LAYER_ID, HIGHLIGHT_LAYER_ID]);
