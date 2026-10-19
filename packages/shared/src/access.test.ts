import { describe, expect, it } from 'vitest';
import {
  GROUP_TEMPLATES,
  ancestorsOf,
  buildUnitTree,
  can,
  canSaveDirectly,
  isWithin,
  unitsFor,
  type UnitNode,
} from './access.js';

const nodes: UnitNode[] = [
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
  { code: '51', level: 'province', parent: 'VN', name: 'Quảng Ngãi' },
  { code: '20194', level: 'ward', parent: '48', name: 'Xã A' },
  { code: '20200', level: 'ward', parent: '48', name: 'Xã B' },
  { code: '21000', level: 'ward', parent: '51', name: 'Xã C' },
];
const tree = buildUnitTree(nodes);
const upd = (unit: string) => ({ permission: 'feature.update' as const, unit });

describe('can', () => {
  it('grants a ward inside a province grant', () => {
    expect(can([upd('48')], 'feature.update', '20194', tree)).toBe(true);
  });
  it('refuses a sibling province', () => {
    expect(can([upd('48')], 'feature.update', '21000', tree)).toBe(false);
  });
  it('refuses another permission', () => {
    expect(can([upd('48')], 'feature.delete', '20194', tree)).toBe(false);
  });
  it('VN covers everything', () => {
    for (const u of ['48', '20194', 'VN']) {
      expect(can([upd('VN')], 'feature.update', u, tree)).toBe(true);
    }
  });
  it('a ward grant does not cover its province', () => {
    expect(can([upd('20194')], 'feature.update', '48', tree)).toBe(false);
  });
  it('unknown unit never matches', () => {
    expect(can([upd('VN')], 'feature.update', '99999', tree)).toBe(false);
    expect(ancestorsOf(tree, '99999')).toEqual([]);
  });
  it('grants from several groups unite', () => {
    const grants = [upd('20194'), upd('51')];
    expect(can(grants, 'feature.update', '21000', tree)).toBe(true);
    expect(can(grants, 'feature.update', '20194', tree)).toBe(true);
    expect(can(grants, 'feature.update', '20200', tree)).toBe(false);
  });
});

describe('ancestorsOf / unitsFor / isWithin', () => {
  it('walks self first up to VN', () => {
    expect(ancestorsOf(tree, '20194')).toEqual(['20194', '48', 'VN']);
  });
  it('does not loop on a malformed tree', () => {
    const bad = buildUnitTree([
      { code: 'a', level: 'province', parent: 'b', name: 'a' },
      { code: 'b', level: 'province', parent: 'a', name: 'b' },
    ]);
    expect(ancestorsOf(bad, 'a')).toEqual(['a', 'b']);
  });
  it('unitsFor returns distinct sorted units of one permission', () => {
    const grants = [upd('51'), upd('48'), upd('51'), { permission: 'map.import' as const, unit: 'VN' }];
    expect(unitsFor(grants, 'feature.update')).toEqual(['48', '51']);
  });
  it('isWithin', () => {
    expect(isWithin('20194', ['48'], tree)).toBe(true);
    expect(isWithin('48', ['20194'], tree)).toBe(false);
  });
});

describe('GROUP_TEMPLATES', () => {
  it('match the spec', () => {
    expect(GROUP_TEMPLATES.map((t) => t.name)).toEqual([
      'Cán bộ cấp Bộ',
      'Cán bộ cấp tỉnh',
      'Cán bộ cấp xã',
    ]);
    expect(GROUP_TEMPLATES.map((t) => t.level)).toEqual(['country', 'province', 'ward']);
    for (const t of GROUP_TEMPLATES) {
      expect(t.permissions).toEqual(['feature.create', 'feature.update', 'feature.delete', 'map.import']);
    }
  });
});

describe('canSaveDirectly', () => {
  const rev = (unit: string) => ({ permission: 'submission.review' as const, unit });

  it('is true with feature.update and submission.review on the same province', () => {
    expect(canSaveDirectly([upd('48'), rev('48')], tree)).toBe(true);
  });
  it('is true when one grant covers the other: update on the province, review on one of its wards', () => {
    expect(canSaveDirectly([upd('48'), rev('20194')], tree)).toBe(true);
  });
  it('is false with feature.update only', () => {
    expect(canSaveDirectly([upd('48')], tree)).toBe(false);
  });
  it('is false when the two rights are on disjoint units', () => {
    expect(canSaveDirectly([upd('48'), rev('51')], tree)).toBe(false);
  });
  it('is false for a grant on a unit missing from the tree', () => {
    expect(canSaveDirectly([upd('99'), rev('99')], tree)).toBe(false);
  });
  it('is false for no grants at all', () => {
    expect(canSaveDirectly([], tree)).toBe(false);
  });
});
