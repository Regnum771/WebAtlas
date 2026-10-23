import { useSyncExternalStore } from 'react';

/** An import whose dialog was closed while the job was still queued or running. */
export interface PendingImport {
  jobId: string;
  /** The map the file goes into; the job's own mapId wins once it is read. */
  mapId: string | null;
}

/**
 * Imports handed off by a closed upload dialog, followed by <MyMaps /> until they end. A module
 * store, like myMaps.store.ts, so the dialog can hand one off as it unmounts.
 */
let pending: PendingImport[] = [];
const listeners = new Set<() => void>();
function publish(next: PendingImport[]) {
  pending = next;
  for (const l of listeners) l();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getPendingImports(): PendingImport[] { return pending; }
export function usePendingImports(): PendingImport[] { return useSyncExternalStore(subscribe, getPendingImports); }

/** Follows the job from now on; a job already followed is not added twice. */
export function handOffImport(entry: PendingImport): void {
  if (pending.some((p) => p.jobId === entry.jobId)) return;
  publish([...pending, entry]);
}

/** Stops following the job. True when it was followed, so its end is handled once. */
export function takePendingImport(jobId: string): boolean {
  if (!pending.some((p) => p.jobId === jobId)) return false;
  publish(pending.filter((p) => p.jobId !== jobId));
  return true;
}

/** Tests only. */
export function resetPendingImports(): void { publish([]); }
