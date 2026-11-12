import { useSyncExternalStore } from 'react';

/**
 * Where OpenLayers draws the coordinate readout and the scale line: elements of the status bar,
 * which is a sibling of the map, not inside it. The status bar registers them through callback
 * refs; MapView hands them to the map model. A module store, so neither side depends on which
 * one mounts first.
 */
export interface ReadoutTargets {
  coordinates: HTMLElement | null;
  scaleLine: HTMLElement | null;
}

let targets: ReadoutTargets = { coordinates: null, scaleLine: null };
const listeners = new Set<() => void>();

function set(patch: Partial<ReadoutTargets>) {
  const next = { ...targets, ...patch };
  if (next.coordinates === targets.coordinates && next.scaleLine === targets.scaleLine) return;
  targets = next;
  for (const l of listeners) l();
}

export const setCoordinatesTarget = (el: HTMLElement | null) => set({ coordinates: el });
export const setScaleLineTarget = (el: HTMLElement | null) => set({ scaleLine: el });

export function getReadoutTargets(): ReadoutTargets {
  return targets;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useReadoutTargets(): ReadoutTargets {
  return useSyncExternalStore(subscribe, getReadoutTargets, getReadoutTargets);
}

/** Tests only. */
export function resetReadoutTargets(): void {
  targets = { coordinates: null, scaleLine: null };
}
