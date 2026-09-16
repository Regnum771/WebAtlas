import type { Dataset } from './types';

function index(datasets: Dataset[]): Map<string, Dataset> {
  return new Map(datasets.map((d) => [d.id, d]));
}

/**
 * Depth-first topological sort. `visiting` detects cycles: re-entering a node that is
 * still on the stack means the graph loops, which must fail loudly rather than hang.
 */
export function topologicalOrder(datasets: Dataset[]): Dataset[] {
  const byId = index(datasets);
  const out: Dataset[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string, trail: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Dependency cycle: ${[...trail, id].join(' -> ')}`);
    }
    const d = byId.get(id);
    if (!d) {
      throw new Error(`Unknown dependency "${id}" (referenced by ${trail.at(-1) ?? 'root'})`);
    }
    visiting.add(id);
    for (const dep of d.dependsOn ?? []) visit(dep, [...trail, id]);
    visiting.delete(id);
    done.add(id);
    out.push(d);
  };

  for (const d of datasets) visit(d.id, []);
  return out;
}

/** --only: the named datasets plus everything they transitively depend on. */
export function withDependencies(datasets: Dataset[], ids: string[]): Dataset[] {
  const byId = index(datasets);
  const keep = new Set<string>();

  const walk = (id: string): void => {
    if (keep.has(id)) return;
    const d = byId.get(id);
    if (!d) throw new Error(`Unknown dataset "${id}"`);
    keep.add(id);
    for (const dep of d.dependsOn ?? []) walk(dep);
  };

  for (const id of ids) walk(id);
  return datasets.filter((d) => keep.has(d.id));
}

/**
 * --except: the named datasets AND everything downstream of them. A dependent cannot
 * be materialised without its parent, so excluding `dem` must also exclude `contours`.
 */
export function withoutDependents(datasets: Dataset[], ids: string[]): Dataset[] {
  const byId = index(datasets);

  // Validate that all ids exist; a typo must not silently skip validation.
  for (const id of ids) {
    if (!byId.has(id)) {
      throw new Error(`Unknown dataset "${id}"`);
    }
  }

  const drop = new Set(ids);
  let changed = true;

  // Iterate to a fixed point so exclusion propagates through chains of any depth.
  while (changed) {
    changed = false;
    for (const d of datasets) {
      if (drop.has(d.id)) continue;
      if ((d.dependsOn ?? []).some((dep) => drop.has(dep))) {
        drop.add(d.id);
        changed = true;
      }
    }
  }

  return datasets.filter((d) => !drop.has(d.id));
}
