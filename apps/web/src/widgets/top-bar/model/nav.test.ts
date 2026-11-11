import { describe, it, expect } from 'vitest';
import type { Grant } from '@webatlas/shared';
import { navFor, resolveNav, NAV_ITEMS, type NavItem } from './nav';
import type { CurrentUser } from '../../../entities/session/model/session.types';
import type { PlatformService } from '../../../entities/platform/model/platform.types';

const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  id: '1', email: 'a@b.test', full_name: null, role: 'viewer', isAdmin: false, grants: [], ...over,
});
const grant = (permission: Grant['permission'], unit = '48'): Grant => ({ permission, unit });
// A stand-in for useCan(): permission held anywhere; per-unit checks need the given unit.
const canFor = (u: CurrentUser | null, units: string[] = []) => (permission: Grant['permission'], unit?: string) =>
  !!u && (u.isAdmin || u.grants.some((g) => g.permission === permission && (unit === undefined || units.includes(unit))));
const labels = (u: CurrentUser | null, can = canFor(u)) => navFor(u, can).map((n) => n.label);

describe('navFor', () => {
  it('a visitor sees Bản đồ, Danh mục and Dữ liệu', () => {
    expect(labels(null)).toEqual(['Bản đồ', 'Danh mục', 'Dữ liệu']);
  });

  it('Bản đồ goes to /ban-do and Dữ liệu to /du-lieu', () => {
    const items = navFor(null, canFor(null));
    expect(items.find((n) => n.label === 'Bản đồ')).toMatchObject({ kind: 'route', to: '/ban-do' });
    expect(items.find((n) => n.label === 'Dữ liệu')).toMatchObject({ kind: 'route', to: '/du-lieu' });
  });

  it('Điều phối and Quản lý are hidden from a reader and shown to admin', () => {
    expect(labels(user())).toEqual(['Bản đồ', 'Danh mục', 'Dữ liệu']);
    expect(labels(user({ role: 'admin', isAdmin: true }))).toEqual(['Bản đồ', 'Danh mục', 'Điều phối', 'Dữ liệu', 'Quản lý']);
  });

  it('shows Quản lý, not Điều phối, to a users.manage holder', () => {
    const u = user({ grants: [grant('users.manage')] });
    expect(labels(u)).toEqual(['Bản đồ', 'Danh mục', 'Dữ liệu', 'Quản lý']);
  });

  it('shows Quản lý to a holder of feature.update and submission.review on VN', () => {
    const u = user({ grants: [grant('feature.update', 'VN'), grant('submission.review', 'VN')] });
    expect(labels(u, canFor(u, ['VN']))).toEqual(['Bản đồ', 'Danh mục', 'Dữ liệu', 'Quản lý']);
    expect(labels(u, canFor(u, []))).toEqual(['Bản đồ', 'Danh mục', 'Dữ liệu']);
  });

  it('hides Quản lý from a holder of feature.update on VN without the review right', () => {
    const u = user({ grants: [grant('feature.update', 'VN')] });
    expect(labels(u, canFor(u, ['VN']))).toEqual(['Bản đồ', 'Danh mục', 'Dữ liệu']);
  });

  it('passes the user and can to a custom visibleWhen', () => {
    const items: NavItem[] = [
      { kind: 'route', to: '/ban-do', label: 'Bản đồ' },
      { kind: 'route', to: '/x', label: 'Riêng', visibleWhen: (u) => u?.isAdmin === true },
    ];
    expect(navFor(user(), canFor(user()), items).map((n) => n.label)).toEqual(['Bản đồ']);
    expect(navFor(null, canFor(null), items).map((n) => n.label)).toEqual(['Bản đồ']);
    const admin = user({ isAdmin: true });
    expect(navFor(admin, canFor(admin), items).map((n) => n.label)).toEqual(['Bản đồ', 'Riêng']);
  });
});

describe('resolveNav', () => {
  const svc = (id: PlatformService['id'], url: string | null, status: PlatformService['status']): PlatformService =>
    ({ id, label: id, url, status, checkedAt: '2026-11-09T00:00:00Z' });

  it('leaves out services before the API has answered', () => {
    expect(resolveNav(NAV_ITEMS, null).map((e) => e.label)).toEqual(['Bản đồ', 'Dữ liệu', 'Quản lý']);
  });

  it('links configured services, marks one that is down, and drops an unconfigured one', () => {
    const entries = resolveNav(NAV_ITEMS, [svc('geonode', 'http://localhost:8000/', 'down'), svc('dagster', null, 'unconfigured')]);
    expect(entries).toEqual([
      { kind: 'route', to: '/ban-do', label: 'Bản đồ' },
      { kind: 'link', href: 'http://localhost:8000/', label: 'Danh mục', down: true },
      { kind: 'route', to: '/du-lieu', label: 'Dữ liệu' },
      { kind: 'route', to: '/quan-ly', label: 'Quản lý' },
    ]);
  });
});
