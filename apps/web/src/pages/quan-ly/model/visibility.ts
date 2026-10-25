import { COUNTRY_UNIT } from '@webatlas/shared';
import type { CurrentUser } from '../../../entities/session/model/session.types';

/** The `can` function that `useCan()` returns. */
export type CanFn = (permission: 'users.manage' | 'feature.update' | 'submission.review' | 'dictionary.manage', unit?: string) => boolean;

type User = CurrentUser | null;

// UX reveals only: the API enforces the same rules on every call.

/** Nhóm quyền: only admin creates, edits and deletes groups. */
export const canSeeGroups = (user: User, _can: CanFn): boolean => user?.isAdmin === true;

/** Người dùng: admin, or anyone holding users.manage somewhere. */
export const canSeeUsers = (user: User, can: CanFn): boolean =>
  user !== null && (user.isAdmin || can('users.manage'));

/**
 * Đơn vị chưa gán: admin, or feature.update AND submission.review on the country unit, since
 * assigning publishes at once until P4 (the API checks the same). P4 relaxes this.
 * False until the unit tree has loaded.
 */
export const canSeeUnassigned = (user: User, can: CanFn): boolean =>
  user !== null && (user.isAdmin || (can('feature.update', COUNTRY_UNIT) && can('submission.review', COUNTRY_UNIT)));

/** Bản đồ cá nhân: admin only (usage and quotas of every user). */
export const canSeeBanDoCaNhan = (user: User, _can: CanFn): boolean => user?.isAdmin === true;

/** Từ điển dữ liệu: admin, or dictionary.manage on the country unit (a provincial grant does not count). */
export const canSeeTuDien = (user: User, can: CanFn): boolean =>
  user !== null && (user.isAdmin || can('dictionary.manage', COUNTRY_UNIT));

export const canSeeQuanLy = (user: User, can: CanFn): boolean =>
  canSeeGroups(user, can) || canSeeUsers(user, can) || canSeeUnassigned(user, can) || canSeeTuDien(user, can);
