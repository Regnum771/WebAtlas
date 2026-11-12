import type { FastifyRequest } from 'fastify';
import { can, unitsFor, PERMISSION_LABELS, type Permission, type UnitTree } from '@webatlas/shared';
import { AuthError, ForbiddenError } from '../errors';
import type { CurrentUser } from '../types/fastify';

function noPermission(permission: Permission): ForbiddenError {
  return new ForbiddenError(`Anh/chị chưa có quyền ${PERMISSION_LABELS[permission]} ở đơn vị nào.`, 'NO_PERMISSION');
}

/**
 * Route guard: the user holds at least one of `perms` on at least one unit. Whether the
 * unit actually touched lies within that jurisdiction is the handler's job (assertCan),
 * since only the handler knows the unit.
 */
export function requirePermission(...perms: Permission[]) {
  if (perms.length === 0) throw new Error('requirePermission needs at least one permission');
  return async (request: FastifyRequest) => {
    const user = request.currentUser;
    if (!user) throw new AuthError();
    if (user.isAdmin) return;
    if (user.grants.some((g) => perms.includes(g.permission))) return;
    throw noPermission(perms[0]);
  };
}

export function requireAdmin() {
  return async (request: FastifyRequest) => {
    const user = request.currentUser;
    if (!user) throw new AuthError();
    if (!user.isAdmin) throw new ForbiddenError('Insufficient role');
  };
}

/**
 * Throws unless the user may exercise `permission` on `unit` (the unit itself or one of its
 * ancestors is granted). Admin always may.
 */
export function assertCan(user: CurrentUser, permission: Permission, unit: string, tree: UnitTree): void {
  if (user.isAdmin) return;
  if (can(user.grants, permission, unit, tree)) return;
  const allowed = unitsFor(user.grants, permission);
  if (allowed.length === 0) throw noPermission(permission);
  const nameOf = (code: string) => tree.get(code)?.name ?? code;
  throw new ForbiddenError(
    `Đối tượng thuộc ${nameOf(unit)}; nhóm của anh/chị chỉ có quyền trong ${allowed.map(nameOf).join(', ')}.`,
    'OUT_OF_JURISDICTION',
    { unit, permission, allowed }
  );
}
