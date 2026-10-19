import type { CurrentUser } from '../../../entities/session/model/session.types';

/** The `can` function that `useCan()` returns. */
export type CanFn = (permission: 'users.manage' | 'feature.update', unit?: string) => boolean;

type User = CurrentUser | null;

// UX reveals only: the API enforces the same rules on every call.

/** Nhóm quyền: only admin creates, edits and deletes groups. */
export const canSeeGroups = (user: User, _can: CanFn): boolean => user?.isAdmin === true;

/** Người dùng: admin, or anyone holding users.manage somewhere. */
export const canSeeUsers = (user: User, can: CanFn): boolean =>
  user !== null && (user.isAdmin || can('users.manage'));

/** Đơn vị chưa gán: admin, or feature.update on the country unit. False until the unit tree has loaded. */
export const canSeeUnassigned = (user: User, can: CanFn): boolean =>
  user !== null && (user.isAdmin || can('feature.update', 'VN'));

export const canSeeQuanLy = (user: User, can: CanFn): boolean =>
  canSeeGroups(user, can) || canSeeUsers(user, can) || canSeeUnassigned(user, can);
