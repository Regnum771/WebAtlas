import type { CurrentUser } from '../../../entities/session/model/session.types';
import { canSeeQuanLy, type CanFn } from '../../../pages/quan-ly/model/visibility';

export interface NavItem {
  to: string;
  label: string;
  visibleWhen?: (user: CurrentUser | null, can: CanFn) => boolean;
}

// Later sub-projects append their screen here.
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Bản đồ' },
  { to: '/du-lieu', label: 'Dữ liệu' },
  { to: '/quan-ly', label: 'Quản lý', visibleWhen: canSeeQuanLy },
];

/** An item without `visibleWhen` is visible to everyone, including a visitor who is not signed in. */
export function navFor(user: CurrentUser | null, can: CanFn, items: readonly NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((item) => !item.visibleWhen || item.visibleWhen(user, can));
}
