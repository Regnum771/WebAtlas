import { useEffect, useRef } from 'react';
import type { Map } from 'ol';

/** Flies the map to a scenario's area as soon as its details arrive, once per scenario chosen. */
export function useFitOnScenario(map: Map | null, scenarioId: string | null, extent: readonly number[] | null): void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!scenarioId) { last.current = null; return; }
    if (!map || !extent || last.current === scenarioId) return;
    last.current = scenarioId;
    // Bottom padding clears the dock.
    map.getView().fit([...extent], { padding: [60, 140, 300, 60], duration: 800 });
  }, [map, scenarioId, extent]);
}
