import { PERMISSION_LABELS, type Grant, type UnitTree } from '@webatlas/shared';

export interface ScopeRow {
  unit: string;
  unitName: string;
  permissions: string[];
}

/** Grants grouped by unit, units in the tree's order of codes, permissions in a stable order. */
export function scopeRows(grants: Grant[], tree: UnitTree | null): ScopeRow[] {
  const byUnit = new Map<string, Set<Grant['permission']>>();
  for (const g of grants) {
    const set = byUnit.get(g.unit) ?? new Set();
    set.add(g.permission);
    byUnit.set(g.unit, set);
  }
  const order = Object.keys(PERMISSION_LABELS) as Grant['permission'][];
  return [...byUnit.entries()]
    .sort(([a], [b]) => (a === 'VN' ? -1 : b === 'VN' ? 1 : a.localeCompare(b)))
    .map(([unit, perms]) => ({
      unit,
      unitName: tree?.get(unit)?.name ?? unit,
      permissions: order.filter((p) => perms.has(p)).map((p) => PERMISSION_LABELS[p]),
    }));
}
