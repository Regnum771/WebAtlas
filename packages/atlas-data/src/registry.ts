import type { Dataset } from './types';
import { DESCRIPTORS } from './descriptors/index';
import { datasetSchema } from './schema';
import { topologicalOrder } from './graph';
import { assertNoOverdueEscapeHatches } from './debt';

export const ALL_DATASETS: Dataset[] = DESCRIPTORS;

/**
 * Every check that must hold before a build may start. Called by the CLI and asserted
 * by the registry test, so a malformed registry fails in CI rather than mid-build.
 *
 * Schema validation runs here, on every dataset, regardless of whether the descriptor
 * file remembered to wrap itself in `defineDataset` (I1): a plain-object descriptor
 * must not be able to skip validation just by being typed `Dataset` instead of parsed.
 */
export function validateRegistry(datasets: Dataset[] = ALL_DATASETS, today: Date = new Date()): void {
  for (const d of datasets) {
    const result = datasetSchema.safeParse(d);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(`Dataset "${d.id}" failed schema validation: ${issues}`);
    }
  }

  const ids = datasets.map((d) => d.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate dataset ids: ${[...new Set(duplicates)].join(', ')}`);
  }
  topologicalOrder(datasets);            // throws on cycles / unknown dependencies
  assertNoOverdueEscapeHatches(datasets, today);
}
