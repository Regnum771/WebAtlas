import { useSyncExternalStore } from 'react';

export interface LayerView { visible: boolean; opacity: number }
export interface MyMapsState {
  expanded: Set<string>;
  layers: Record<string, LayerView>;
  collapsed: boolean;
  /** Per layer: how many features the last viewport read showed when the API cut it short. */
  truncated: Record<string, number>;
  /** A personal drawing or feature-edit mode holds the map's clicks (set by Task 8's modes). */
  personalEditing: boolean;
}

const DEFAULT_VIEW: LayerView = { visible: true, opacity: 1 };
const initial = (): MyMapsState => ({ expanded: new Set(), layers: {}, collapsed: false, truncated: {}, personalEditing: false });

/** Panel state for personal maps: which cards are open and each personal layer's visibility and opacity. A module store, like shell.store.ts. */
let state: MyMapsState = initial();
const listeners = new Set<() => void>();
function publish(next: MyMapsState) {
  state = next;
  for (const l of listeners) l();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getMyMaps(): MyMapsState { return state; }
export function useMyMapsStore(): MyMapsState { return useSyncExternalStore(subscribe, getMyMaps); }

export function toggleCollapsed(): void { publish({ ...state, collapsed: !state.collapsed }); }
export function toggleExpanded(mapId: string): void {
  const expanded = new Set(state.expanded);
  if (!expanded.delete(mapId)) expanded.add(mapId);
  publish({ ...state, expanded });
}
export function expandMap(mapId: string): void {
  if (state.expanded.has(mapId)) return;
  publish({ ...state, expanded: new Set(state.expanded).add(mapId) });
}
/** A layer seen for the first time is visible at full opacity. */
export function layerView(layerId: string): LayerView { return state.layers[layerId] ?? DEFAULT_VIEW; }
export function setLayerVisible(layerId: string, visible: boolean): void {
  publish({ ...state, layers: { ...state.layers, [layerId]: { ...layerView(layerId), visible } } });
}
export function setLayerOpacity(layerId: string, opacity: number): void {
  publish({ ...state, layers: { ...state.layers, [layerId]: { ...layerView(layerId), opacity } } });
}
/** Records a cut read (`n` features shown) or clears it (`null`); an unchanged value publishes nothing. */
export function setTruncated(layerId: string, n: number | null): void {
  if ((state.truncated[layerId] ?? null) === n) return;
  const truncated = { ...state.truncated };
  if (n === null) delete truncated[layerId];
  else truncated[layerId] = n;
  publish({ ...state, truncated });
}
export function setPersonalEditing(personalEditing: boolean): void {
  if (state.personalEditing === personalEditing) return;
  publish({ ...state, personalEditing });
}
/** Drops a deleted or revoked map and its layers' view state. */
export function forgetMap(mapId: string, layerIds: string[]): void {
  const expanded = new Set(state.expanded);
  expanded.delete(mapId);
  const layers = { ...state.layers };
  const truncated = { ...state.truncated };
  for (const id of layerIds) {
    delete layers[id];
    delete truncated[id];
  }
  publish({ ...state, expanded, layers, truncated });
}

/** Tests only. */
export function resetMyMapsStore(): void { publish(initial()); }
