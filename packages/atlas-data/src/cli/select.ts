import type { Dataset } from '../types';
import { withDependencies, withoutDependents } from '../graph';

export interface ExclusionReason {
  id: string;
  reason: string;
}

export interface Selection {
  selected: Dataset[];
  excluded: ExclusionReason[];
}

/**
 * Pure --only/--except selection logic for atlas:build (I2). Given the full registry
 * and the parsed flags, returns what survives AND, for everything that doesn't, why —
 * so the CLI can print what it excluded instead of silently building a subset (spec §4).
 *
 * `--only`'s kept set and `--except`'s kept set are each computed independently against
 * the FULL dataset list, then intersected — rather than chaining withDependencies's
 * result into withoutDependents as build.ts used to. Chaining would make withoutDependents
 * throw "Unknown dataset" whenever an --except id was a dataset that --only had already
 * dropped, even though the id is perfectly valid. Computing both against `all` avoids
 * that, and is equivalent to the old sequential composition: withDependencies's output is
 * closed under dependsOn, so a dependency chain entirely inside it propagates identically
 * whether exclusion is computed over `all` or over that subset (the graph is acyclic, so
 * nothing outside the --only subset can be an ancestor that feeds back into it).
 *
 * Precedence when a dataset is excluded by both flags: --except wins. --except is the
 * safety-relevant flag (a typo must never silently turn "skip basemap" into "build
 * everything"), so when both reasons apply, the more conservative, explicit-exclusion
 * reason is the one reported.
 */
export function selectDatasets(
  all: Dataset[],
  { only, except }: { only: string[]; except: string[] }
): Selection {
  const keptByOnly = only.length > 0 ? new Set(withDependencies(all, only).map((d) => d.id)) : null;
  const keptByExcept =
    except.length > 0 ? new Set(withoutDependents(all, except).map((d) => d.id)) : null;

  const selected = all.filter((d) => {
    if (keptByOnly && !keptByOnly.has(d.id)) return false;
    if (keptByExcept && !keptByExcept.has(d.id)) return false;
    return true;
  });
  const selectedIds = new Set(selected.map((d) => d.id));

  const excluded: ExclusionReason[] = [];
  for (const d of all) {
    if (selectedIds.has(d.id)) continue;
    const droppedByExcept = keptByExcept !== null && !keptByExcept.has(d.id);
    excluded.push({ id: d.id, reason: droppedByExcept ? '--except' : 'not in --only' });
  }

  return { selected, excluded };
}
