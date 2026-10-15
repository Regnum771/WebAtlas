import { useEffect, useState } from 'react';
import type { FloodImpacts, FloodScenarioId } from '@webatlas/shared';
import { fetchImpacts } from '../api/flood.api';

/** Waits for the slider to settle before asking: a drag across 137 hours is one request, not 137. */
const SETTLE_MS = 250;

/** Totals flooded by `hour`, for the dock's summary line; null while unknown or not ready. */
export function useImpactsSummary(
  scenarioId: FloodScenarioId | null,
  ready: boolean,
  hour: number,
  fetch: typeof fetchImpacts = fetchImpacts,
): FloodImpacts['totals'] | null {
  const [totals, setTotals] = useState<FloodImpacts['totals'] | null>(null);
  useEffect(() => {
    if (!scenarioId || !ready) { setTotals(null); return; }
    let current = true;
    const timer = setTimeout(() => {
      fetch(scenarioId, hour)
        .then((d) => { if (current) setTotals(d.totals); })
        .catch(() => { if (current) setTotals(null); });
    }, SETTLE_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [scenarioId, ready, hour, fetch]);
  return totals;
}
