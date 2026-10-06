import { describe, it, expect } from 'vitest';
import { navFor, type NavItem } from './nav';

describe('navFor', () => {
  it('lists only Bản đồ in this sub-project', () => {
    expect(navFor(null).map((n) => n.label)).toEqual(['Bản đồ']);
  });

  it('hides an item from a role it is not visible to', () => {
    const items: NavItem[] = [
      { to: '/', label: 'Bản đồ' },
      { to: '/x', label: 'Riêng', visibleTo: ['admin'] },
    ];
    expect(navFor('viewer', items).map((n) => n.label)).toEqual(['Bản đồ']);
    expect(navFor(null, items).map((n) => n.label)).toEqual(['Bản đồ']);
    expect(navFor('admin', items).map((n) => n.label)).toEqual(['Bản đồ', 'Riêng']);
  });
});
