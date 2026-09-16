import type { Dataset } from './types';
import { DESCRIPTORS } from './descriptors/index';
import { topologicalOrder } from './graph';
import { assertNoOverdueEscapeHatches } from './debt';

export const ALL_DATASETS: Dataset[] = DESCRIPTORS;

/**
 * Every check that must hold before a build may start. Called by the CLI and asserted
 * by the registry test, so a malformed registry fails in CI rather than mid-build.
 */
export function validateRegistry(today: Date = new Date()): void {
  const ids = ALL_DATASETS.map((d) => d.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate dataset ids: ${[...new Set(duplicates)].join(', ')}`);
  }
  topologicalOrder(ALL_DATASETS);            // throws on cycles / unknown dependencies
  assertNoOverdueEscapeHatches(ALL_DATASETS, today);
}
