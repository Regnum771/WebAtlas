import type { Role } from '../../../entities/session/model/session.types';

export interface NavItem { to: string; label: string; visibleTo?: readonly Role[] }

// Later sub-projects append their screen here.
export const NAV_ITEMS: readonly NavItem[] = [{ to: '/', label: 'Bản đồ' }];

/** An item without `visibleTo` is visible to everyone, including a visitor who is not signed in. */
export function navFor(role: Role | null, items: readonly NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((item) => !item.visibleTo || (role !== null && item.visibleTo.includes(role)));
}
