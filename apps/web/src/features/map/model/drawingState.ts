import { useSyncExternalStore } from 'react';

/** Who owns the map's clicks right now: an ROI drawing or the Đo nhanh ruler. */
export type DrawOwner = 'roi' | 'ruler';

export interface DrawFeedback {
  owner: DrawOwner | null;
  /** The drawing aids' current hint (U-11), e.g. "Nhấp để khép vùng". */
  hint: string | null;
  /** The live length or area of the shape being drawn. */
  measure: string | null;
}

/** OpenLayers fires `singleclick` about 250 ms after the click; cover it. */
export const DRAW_GRACE_MS = 300;
let lastReleasedAt = -Infinity;
let state: DrawFeedback = { owner: null, hint: null, measure: null };
const listeners = new Set<() => void>();
function publish(next: DrawFeedback) { state = next; for (const l of listeners) l(); }

/** Taking over from another owner is allowed; that owner reacts by stopping. */
export function claimDrawing(owner: DrawOwner): void { publish({ owner, hint: null, measure: null }); }
/** Only the current owner can release — a late release after a hand-over is ignored. */
export function releaseDrawing(owner: DrawOwner): void {
  if (state.owner === owner) lastReleasedAt = Date.now();
  if (state.owner === owner) publish({ owner: null, hint: null, measure: null });
}
export function setDrawFeedback(patch: Partial<Pick<DrawFeedback, 'hint' | 'measure'>>): void {
  publish({ ...state, ...patch });
}
/** Read by the popup: while anything is drawing, a map click is not an inspection. */
export function isDrawing(): boolean { return state.owner !== null; }
/** True just after a drawing ended: the click that finished it is not an inspection. */
export function drawingJustEnded(): boolean { return Date.now() - lastReleasedAt < DRAW_GRACE_MS; }
/** For tests: forget the owner, feedback and the grace-window timestamp. */
export function resetDrawing(): void { lastReleasedAt = -Infinity; publish({ owner: null, hint: null, measure: null }); }
export function getDrawFeedback(): DrawFeedback { return state; }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useDrawFeedback(): DrawFeedback { return useSyncExternalStore(subscribe, getDrawFeedback, getDrawFeedback); }
