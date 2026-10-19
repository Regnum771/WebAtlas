import { can, isWithin, unitsFor, type Grant, type Permission, type UnitTree } from '@webatlas/shared';

/**
 * Mirrors the API no-escalation rule: a non-admin holder may hand over a group only when
 * every unit lies within their users.manage scope and they hold every permission on every unit.
 * Without a tree the answer is false for non-admins.
 */
export function canHandOver(
  holder: { isAdmin: boolean; grants: readonly Grant[] },
  group: { units: readonly string[]; permissions: readonly Permission[] },
  tree: UnitTree | null,
): boolean {
  if (holder.isAdmin) return true;
  if (!tree) return false;
  const scope = unitsFor(holder.grants, 'users.manage');
  return group.units.every((unit) =>
    isWithin(unit, scope, tree) && group.permissions.every((p) => can(holder.grants, p, unit, tree)),
  );
}
