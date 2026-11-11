import type { CurrentUser } from '../../../entities/session/model/session.types';
import type { PlatformService, PlatformServiceId } from '../../../entities/platform/model/platform.types';
import { canSeeQuanLy, type CanFn } from '../../../pages/quan-ly/model/visibility';

type Visibility = (user: CurrentUser | null, can: CanFn) => boolean;

/** A screen of this app, or another service of the platform (opened in a new tab). */
export type NavItem =
  | { kind: 'route'; to: string; label: string; visibleWhen?: Visibility }
  | { kind: 'service'; service: PlatformServiceId; label: string; visibleWhen?: Visibility };

/** What the top bar renders: a route, or a resolved external link. */
export type NavEntry =
  | { kind: 'route'; to: string; label: string }
  | { kind: 'link'; href: string; label: string; down: boolean };

const isAdmin: Visibility = (user) => user?.isAdmin === true;

export const NAV_ITEMS: readonly NavItem[] = [
  { kind: 'route', to: '/ban-do', label: 'Bản đồ' },
  { kind: 'service', service: 'geonode', label: 'Danh mục' },
  { kind: 'service', service: 'dagster', label: 'Điều phối', visibleWhen: isAdmin },
  { kind: 'route', to: '/du-lieu', label: 'Dữ liệu' },
  { kind: 'route', to: '/quan-ly', label: 'Quản lý', visibleWhen: canSeeQuanLy },
];

/** An item without `visibleWhen` is visible to everyone, including a visitor who is not signed in. */
export function navFor(user: CurrentUser | null, can: CanFn, items: readonly NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((item) => !item.visibleWhen || item.visibleWhen(user, can));
}

/** A service the API has no address for is left out; one that is down stays, marked. */
export function resolveNav(items: readonly NavItem[], services: PlatformService[] | null): NavEntry[] {
  const out: NavEntry[] = [];
  for (const item of items) {
    if (item.kind === 'route') { out.push({ kind: 'route', to: item.to, label: item.label }); continue; }
    const s = services?.find((x) => x.id === item.service);
    if (!s?.url) continue;
    out.push({ kind: 'link', href: s.url, label: item.label, down: s.status === 'down' });
  }
  return out;
}
