import type { Dataset } from './types';

/**
 * The `run` stage is a temporary escape hatch (spec §2). Each one declares when it
 * must be promoted to a built-in. Once that date passes this throws, which fails the
 * registry test and therefore the build — the hatch cannot quietly become permanent.
 *
 * `today` is injectable so the test does not depend on the wall clock.
 */
export function assertNoOverdueEscapeHatches(datasets: Dataset[], today: Date = new Date()): void {
  const overdue: string[] = [];

  for (const d of datasets) {
    for (const stage of d.stages) {
      if (stage.type !== 'run') continue;
      if (new Date(`${stage.promoteBy}T00:00:00Z`) < today) {
        overdue.push(
          `  ${d.id}: run "${stage.command}" had promoteBy ${stage.promoteBy}, ` +
            `should have been promoted to "${stage.promoteTo}"`
        );
      }
    }
  }

  if (overdue.length > 0) {
    throw new Error(
      `Escape-hatch promotion overdue for ${overdue.length} stage(s):\n${overdue.join('\n')}`
    );
  }
}
