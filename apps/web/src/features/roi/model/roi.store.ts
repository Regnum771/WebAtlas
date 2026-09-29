import { useSyncExternalStore } from 'react';
import { withRadius, type ResolvedRoi, type Roi } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { resolveRoi } from '../api/roi.api';

export type RoiDrawKind = 'Polygon' | 'Box' | 'LineString' | 'Point';
export type RoiStatus = 'empty' | 'drawing' | 'resolving' | 'ready';
/** How the map frames a newly resolved ROI (U-5): always, never, or only if it is off screen. */
export type RoiFit = boolean | 'ifOutside';

export interface RoiState {
  roi: Roi | null;
  resolved: ResolvedRoi | null;
  status: RoiStatus;
  /** Why the last pick failed. The previous ROI is kept (FR-14). */
  error: string | null;
  /** A neutral message — e.g. why a pressed tool is disabled (U-2). */
  hint: string | null;
  drawKind: RoiDrawKind | null;
  fit: RoiFit;
}

const EMPTY: RoiState = {
  roi: null, resolved: null, status: 'empty', error: null, hint: null, drawKind: null, fit: false,
};

/**
 * The one active ROI (D1). A module store, like analysisResult.store.ts, so the popup,
 * search, result cards and the toolbar all read and set it without prop-drilling.
 */
let state: RoiState = EMPTY;
const listeners = new Set<() => void>();
function publish(next: RoiState) { state = next; for (const l of listeners) l(); }
function update(patch: Partial<RoiState>) { publish({ ...state, ...patch }); }

let resolver: (roi: Roi) => Promise<ResolvedRoi> = resolveRoi;
/** Each pick bumps this; a response for an older pick is dropped. */
let seq = 0;

/** Tests only. */
export function setRoiResolver(fn: (roi: Roi) => Promise<ResolvedRoi>): void { resolver = fn; }
/** Tests only. */
export function resetRoiStore(): void { seq++; resolver = resolveRoi; publish(EMPTY); }

export async function setRoi(roi: Roi, opts: { fit: RoiFit }): Promise<void> {
  const mine = ++seq;
  const kept = { roi: state.roi, resolved: state.resolved };
  update({ status: 'resolving', error: null, hint: null, drawKind: null });
  try {
    const resolved = await resolver(roi);
    if (mine !== seq) return;
    if (state.status === 'drawing') {
      update({ roi, resolved, fit: opts.fit });
    } else {
      update({ roi, resolved, status: 'ready', fit: opts.fit, drawKind: null });
    }
  } catch (e) {
    if (mine !== seq) return;
    const message = e instanceof ApiError ? e.message : 'Không xác định được vùng phân tích.';
    if (state.status === 'drawing') {
      update({ error: message });
    } else {
      update({
        ...kept,
        status: kept.resolved ? 'ready' : 'empty',
        error: message,
      });
    }
  }
}

/** A radius turns a line or point into an area; null returns it to the line or point. */
export function setRadius(radiusKm: number | null): Promise<void> {
  if (!state.roi) return Promise.resolve();
  return setRoi(withRadius(state.roi, radiusKm), { fit: 'ifOutside' });
}

export function clearRoi(): void { seq++; publish(EMPTY); }
export function startDrawing(kind: RoiDrawKind): void { update({ status: 'drawing', drawKind: kind, error: null, hint: null }); }
export function stopDrawing(): void {
  if (state.status !== 'drawing') return;
  update({ status: state.resolved ? 'ready' : 'empty', drawKind: null });
}
export function setRoiHint(hint: string | null): void { update({ hint }); }
export function dismissRoiMessage(): void { update({ error: null, hint: null }); }

export function getRoiState(): RoiState { return state; }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useRoi(): RoiState { return useSyncExternalStore(subscribe, getRoiState, getRoiState); }
