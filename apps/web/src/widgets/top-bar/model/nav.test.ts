import { describe, it, expect } from 'vitest';
import type { Grant } from '@webatlas/shared';
import { navFor, type NavItem } from './nav';
import type { CurrentUser } from '../../../entities/session/model/session.types';

const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  id: '1', email: 'a@b.test', full_name: null, role: 'viewer', isAdmin: false, grants: [], ...over,
});
const grant = (permission: Grant['permission'], unit = '48'): Grant => ({ permission, unit });
// A stand-in for useCan(): permission held anywhere; per-unit checks need the given unit.
const canFor = (u: CurrentUser | null, units: string[] = []) => (permission: Grant['permission'], unit?: string) =>
  !!u && (u.isAdmin || u.grants.some((g) => g.permission === permission && (unit === undefined || units.includes(unit))));
const labels = (u: CurrentUser | null, can = canFor(u)) => navFor(u, can).map((n) => n.label);

describe('navFor', () => {
  it('a visitor sees only Bản đồ', () => {
    expect(labels(null)).toEqual(['Bản đồ']);
  });

  it('Quản lý is hidden from a reader and shown to admin', () => {
    expect(labels(user())).toEqual(['Bản đồ']);
    expect(labels(user({ role: 'admin', isAdmin: true }))).toEqual(['Bản đồ', 'Quản lý']);
  });

  it('shows Quản lý to a users.manage holder', () => {
    const u = user({ grants: [grant('users.manage')] });
    expect(labels(u)).toEqual(['Bản đồ', 'Quản lý']);
  });

  it('shows Quản lý to a holder of feature.update and submission.review on VN', () => {
    const u = user({ grants: [grant('feature.update', 'VN'), grant('submission.review', 'VN')] });
    expect(labels(u, canFor(u, ['VN']))).toEqual(['Bản đồ', 'Quản lý']);
    expect(labels(u, canFor(u, []))).toEqual(['Bản đồ']);
  });

  it('hides Quản lý from a holder of feature.update on VN without the review right', () => {
    const u = user({ grants: [grant('feature.update', 'VN')] });
    expect(labels(u, canFor(u, ['VN']))).toEqual(['Bản đồ']);
  });

  it('passes the user and can to a custom visibleWhen', () => {
    const items: NavItem[] = [
      { to: '/', label: 'Bản đồ' },
      { to: '/x', label: 'Riêng', visibleWhen: (u) => u?.isAdmin === true },
    ];
    expect(navFor(user(), canFor(user()), items).map((n) => n.label)).toEqual(['Bản đồ']);
    expect(navFor(null, canFor(null), items).map((n) => n.label)).toEqual(['Bản đồ']);
    const admin = user({ isAdmin: true });
    expect(navFor(admin, canFor(admin), items).map((n) => n.label)).toEqual(['Bản đồ', 'Riêng']);
  });
});
