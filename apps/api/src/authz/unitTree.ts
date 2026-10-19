import type { Pool } from 'pg';
import { buildUnitTree, type UnitNode, type UnitTree } from '@webatlas/shared';

const TTL_MS = 10 * 60_000;

// admin.unit_tree is small (~650 rows) and changes only when the boundary data is reloaded,
// so one copy per process is kept and refreshed after the TTL.
let cached: { tree: UnitTree; loadedAt: number } | null = null;
// Concurrent misses share one query instead of each loading the tree.
let pending: Promise<UnitTree> | null = null;
// Bumped by invalidateUnitTree so a load started before the invalidation is not cached.
let generation = 0;

export async function getUnitTree(pg: Pool): Promise<UnitTree> {
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached.tree;
  if (pending) return pending;
  const started = generation;
  const load = loadTree(pg, started).finally(() => {
    if (pending === load) pending = null;
  });
  pending = load;
  return load;
}

async function loadTree(pg: Pool, started: number): Promise<UnitTree> {
  const { rows } = await pg.query<UnitNode>(`SELECT code, level, parent, name FROM admin.unit_tree`);
  const tree = buildUnitTree(rows);
  if (started === generation) cached = { tree, loadedAt: Date.now() };
  return tree;
}

export function invalidateUnitTree(): void {
  cached = null;
  pending = null;
  generation++;
}
