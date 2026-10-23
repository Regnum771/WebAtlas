import { useSyncExternalStore } from 'react';
import type { TableCondition } from '../api/workspace.api';

export interface TableFilter {
  q: string;
  conditions: TableCondition[];
  match: 'all' | 'any';
  inView: boolean;
  sort: { field: string; dir: 'asc' | 'desc' } | null;
  page: number;
}
export interface TableState {
  open: { mapId: string; layerId: string } | null;
  /** Each layer's filter, kept for the session. */
  byLayer: Record<string, TableFilter>;
  selectedId: string | null;
  /** Bumped by relocate(): the table asks again where the selected feature is. */
  locateSeq: number;
}

export const emptyFilter = (): TableFilter => ({ q: '', conditions: [], match: 'all', inView: false, sort: null, page: 0 });
const initial = (): TableState => ({ open: null, byLayer: {}, selectedId: null, locateSeq: 0 });

/** Which layer's table is open, each layer's filter and the selected feature. A module store, like myMaps.store.ts. */
let state: TableState = initial();
const listeners = new Set<() => void>();
function publish(next: TableState) {
  state = next;
  for (const l of listeners) l();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getTableState(): TableState { return state; }
export function useTableStore(): TableState { return useSyncExternalStore(subscribe, getTableState); }

/** Switches the table to a layer; that layer's filter from earlier in the session is kept. */
export function openTable(mapId: string, layerId: string): void {
  if (state.open?.mapId === mapId && state.open.layerId === layerId) return;
  publish({
    ...state,
    open: { mapId, layerId },
    byLayer: state.byLayer[layerId] ? state.byLayer : { ...state.byLayer, [layerId]: emptyFilter() },
    selectedId: null,
  });
}
export function closeTable(): void {
  if (state.open === null && state.selectedId === null) return;
  publish({ ...state, open: null, selectedId: null });
}
/** Patches the open layer's filter; the page goes back to 0 unless the patch sets it. */
export function setFilter(patch: Partial<TableFilter>): void {
  if (!state.open) return;
  const id = state.open.layerId;
  const current = state.byLayer[id] ?? emptyFilter();
  const next: TableFilter = { ...current, ...patch, page: 'page' in patch ? (patch.page as number) : 0 };
  publish({ ...state, byLayer: { ...state.byLayer, [id]: next } });
}
export function select(id: string | null): void {
  if (state.selectedId === id) return;
  publish({ ...state, selectedId: id });
}
/**
 * Locates the selected feature again, even when its row is on the page: a map click on the
 * feature already selected (back to its page), or a save (does it still match the filter?).
 */
export function relocate(): void {
  if (state.selectedId === null) return;
  publish({ ...state, locateSeq: state.locateSeq + 1 });
}

/** Signing out (nothing of the table outlives the session), and tests. */
export function resetTableStore(): void { publish(initial()); }
