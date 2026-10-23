import type { Pool } from 'pg';
import { reconcileStore, type ReconcileResult } from './cleanup';

/*
 * The cleanup CLI's argument handling and its store-reconciliation step, apart from
 * scripts/workspaceCleanup.ts so tests can run them against a temp store without running the
 * whole-database steps.
 */

export interface CleanupFlags {
  /** Also archive maps whose notice is old enough (not before P4 delivers notices). */
  archive: boolean;
  /** Look for orphan files in the store (dry run unless `apply`). */
  reconcile: boolean;
  /** With `reconcile`: delete the orphans found. */
  apply: boolean;
  /** With `reconcile`: lift the size guard (RECONCILE_MAX_FILES / RECONCILE_MAX_SHARE). */
  force: boolean;
}

export const CLEANUP_USAGE =
  'usage: npm run workspace:cleanup -w @webatlas/api -- [--archive] [--reconcile [--apply] [--force]]';

/** Parse the CLI's flags. Throws (with the usage) on an unknown flag, or --apply / --force without --reconcile. */
export function parseCleanupArgs(argv: string[]): CleanupFlags {
  const flags: CleanupFlags = { archive: false, reconcile: false, apply: false, force: false };
  for (const arg of argv) {
    switch (arg) {
      case '--archive': flags.archive = true; break;
      case '--reconcile': flags.reconcile = true; break;
      case '--apply': flags.apply = true; break;
      case '--force': flags.force = true; break;
      default: throw new Error(`unknown argument ${JSON.stringify(arg)}\n${CLEANUP_USAGE}`);
    }
  }
  if ((flags.apply || flags.force) && !flags.reconcile) {
    throw new Error(`--apply and --force only go with --reconcile\n${CLEANUP_USAGE}`);
  }
  return flags;
}

const HOUR_MS = 60 * 60 * 1000;

/** The lines the CLI prints for a reconcile run. */
export function describeReconcile(result: ReconcileResult, apply: boolean): string[] {
  const lines: string[] = [];
  if (result.root) {
    lines.push(
      `reconcileStore: store ${result.root}; ${result.filesSeen} file(s) under uploads/, cog/, exports/; ` +
        `${result.candidates.length} orphan candidate(s)`
    );
  }
  for (const c of result.candidates) {
    lines.push(`  ${c.path}  ${c.sizeBytes} bytes  ${(c.ageMs / HOUR_MS).toFixed(1)} h old`);
  }
  if (result.refused) {
    lines.push(`reconcileStore REFUSED, nothing deleted: ${result.refused}`);
  } else if (!apply) {
    lines.push(`reconcileStore: dry run, nothing deleted; pass --reconcile --apply to delete the candidates`);
  } else {
    lines.push(`reconcileStore: removed ${result.removed} of ${result.candidates.length} candidate(s)`);
  }
  return lines;
}

/**
 * The CLI's reconcile step: run reconcileStore (a dry run unless flags.apply), print what it
 * found and did, and return the exit code: 1 when a guard refused the run, 0 otherwise.
 */
export async function runReconcile(
  pg: Pool, now: Date, flags: Pick<CleanupFlags, 'apply' | 'force'>, log: (line: string) => void = console.log
): Promise<number> {
  const result = await reconcileStore(pg, now, { apply: flags.apply, force: flags.force });
  for (const line of describeReconcile(result, flags.apply)) log(line);
  return result.refused ? 1 : 0;
}
