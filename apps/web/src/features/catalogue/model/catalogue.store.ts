import { useSyncExternalStore } from 'react';
import { ApiError } from '../../../shared/api/apiClient';
import { getCatalogueItem, type CatalogueItem } from '../api/catalogue.api';

export interface CatalogueLayer {
  item: CatalogueItem;
  visible: boolean;
  opacity: number;
  /** `gone`: the entry was deleted or is no longer visible to this user. */
  status: 'ok' | 'gone';
}

/** The catalogue entries put on the map, in the order added. A module store, like myMaps.store.ts. */
let state: CatalogueLayer[] = [];
const listeners = new Set<() => void>();
function publish(next: CatalogueLayer[]) {
  state = next;
  for (const l of listeners) l();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getCatalogue(): CatalogueLayer[] { return state; }
export function useCatalogueStore(): CatalogueLayer[] { return useSyncExternalStore(subscribe, getCatalogue); }

/** An entry already on the map stays as it is. */
export function addCatalogueLayer(item: CatalogueItem): void {
  if (state.some((l) => l.item.id === item.id)) return;
  publish([...state, { item, visible: true, opacity: 1, status: 'ok' }]);
}
export function removeCatalogueLayer(id: string): void {
  publish(state.filter((l) => l.item.id !== id));
}
export function setCatalogueLayer(id: string, patch: Partial<Pick<CatalogueLayer, 'visible' | 'opacity' | 'status'>>): void {
  publish(state.map((l) => (l.item.id === id ? { ...l, ...patch } : l)));
}
/** Test helper. */
export function resetCatalogue(): void { publish([]); }

/**
 * Re-reads every entry on the map: a 404 means it was deleted or became invisible (`gone`);
 * a fresh read replaces the stored item; any other failure leaves the layer unchanged.
 */
export async function refreshCatalogueLayers(): Promise<void> {
  await Promise.all(state.map(async ({ item }) => {
    try {
      const fresh = await getCatalogueItem(item.id);
      publish(state.map((l) => (l.item.id === item.id ? { ...l, item: fresh, status: 'ok' } : l)));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setCatalogueLayer(item.id, { status: 'gone' });
    }
  }));
}

/** A 404/403 on an entry's image or legend means it was deleted or is no longer visible: mark it gone. */
export function markGoneIfDenied(id: string, error: unknown): void {
  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) setCatalogueLayer(id, { status: 'gone' });
}
