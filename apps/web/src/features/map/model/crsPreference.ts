import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_CRS_ID, findCrs } from '@webatlas/shared';

const KEY = 'webatlas.crs';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return findCrs(localStorage.getItem(KEY) ?? DEFAULT_CRS_ID).id;
  } catch {
    return DEFAULT_CRS_ID; // storage blocked (private window) — default, don't crash
  }
}

let current = read();

export function getCrsPreference(): string { return current; }

export function setCrsPreference(id: string): void {
  current = findCrs(id).id;
  try { localStorage.setItem(KEY, current); } catch { /* per-viewer convenience only */ }
  for (const l of listeners) l();
}

export function useCrsPreference(): [string, (id: string) => void] {
  const id = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    getCrsPreference,
    getCrsPreference
  );
  return [id, useCallback((next: string) => setCrsPreference(next), [])];
}
