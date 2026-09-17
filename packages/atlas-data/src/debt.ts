import type { Dataset } from './types';

/**
 * The `run` stage is a temporary escape hatch (spec §2). Each one declares when it
 * must be promoted to a built-in. This throws when today's UTC calendar date is
 * strictly after `promoteBy`, which fails the registry test and therefore the build —
 * the hatch cannot quietly become permanent. The stage is valid for the whole of its
 * promoteBy day in UTC.
 *
 * UTC is used so the result is identical on every machine and on CI runners
 * regardless of local timezone.
 *
 * `today` is injectable so the test does not depend on the wall clock.
 */
export function assertNoOverdueEscapeHatches(datasets: Dataset[], today: Date = new Date()): void {
  const todayUtc = today.toISOString().slice(0, 10);
  const overdue: string[] = [];

  for (const d of datasets) {
    for (const stage of d.stages) {
      if (stage.type !== 'run') continue;
      if (stage.promoteBy < todayUtc) {
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
