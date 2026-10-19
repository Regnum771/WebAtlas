import { describe, it, expect } from 'vitest';
import { buildUnitTree, type Grant } from '@webatlas/shared';
import { canHandOver } from './canHandOver';

const tree = buildUnitTree([
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
  { code: '20194', level: 'ward', parent: '48', name: 'Xã Điện Hồng' },
  { code: '01', level: 'province', parent: 'VN', name: 'Hà Nội' },
]);
const holder = (...grants: Grant[]) => ({ isAdmin: false, grants });
const g = (permissions: Grant['permission'][], units: string[]) => ({ permissions, units });

const mine: Grant[] = [
  { permission: 'users.manage', unit: '48' },
  { permission: 'feature.update', unit: '48' },
];

describe('canHandOver', () => {
  it('admin may hand over anything, even without a tree', () => {
    expect(canHandOver({ isAdmin: true, grants: [] }, g(['users.manage'], ['VN']), null)).toBe(true);
  });
  it('allows a group inside both the unit scope and the permission set', () => {
    expect(canHandOver(holder(...mine), g(['feature.update'], ['20194']), tree)).toBe(true);
  });
  it('refuses a unit outside the users.manage scope', () => {
    expect(canHandOver(holder(...mine), g(['feature.update'], ['01']), tree)).toBe(false);
  });
  it('refuses a permission the holder lacks on that unit', () => {
    expect(canHandOver(holder(...mine), g(['feature.update', 'map.import'], ['48']), tree)).toBe(false);
  });
  it('refuses when the tree is not loaded', () => {
    expect(canHandOver(holder(...mine), g(['feature.update'], ['48']), null)).toBe(false);
  });
});
