import { describe, it, expect } from 'vitest';
import { applyFilter, type FeatureLike } from './applyFilter';

function feat(props: Record<string, unknown>, geom: unknown = { type: 'Point' }): FeatureLike {
  return { getProperties: () => props, getGeometry: () => geom };
}

describe('applyFilter', () => {
  const dams = [
    feat({ geographicalName: 'Đập A', statusSlug: 'xa_lu', ratedPower: 250 }),
    feat({ geographicalName: 'Đập B', statusSlug: 'binh_thuong', ratedPower: 100 }),
    feat({ geographicalName: 'Hồ C', statusSlug: 'xa_lu', ratedPower: 50 }),
  ];

  it('empty conditions -> all features (no filter means no predicate)', () => {
    expect(applyFilter(dams, [])).toEqual(dams);
  });

  it('eq on an enum matches exactly', () => {
    const r = applyFilter(dams, [{ field: 'statusSlug', op: 'eq', value: 'xa_lu' }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập A', 'Hồ C']);
  });

  it('gte on a number', () => {
    const r = applyFilter(dams, [{ field: 'ratedPower', op: 'gte', value: 200 }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập A']);
  });

  it('lte on a number', () => {
    const r = applyFilter(dams, [{ field: 'ratedPower', op: 'lte', value: 100 }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập B', 'Hồ C']);
  });

  it('between is inclusive on both ends', () => {
    const r = applyFilter(dams, [{ field: 'ratedPower', op: 'between', value: 50, value2: 100 }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập B', 'Hồ C']);
  });

  it('text contains is a case-insensitive substring match', () => {
    const r = applyFilter(dams, [{ field: 'geographicalName', op: 'contains', value: 'đập' }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập A', 'Đập B']);
  });

  it('multiple conditions are ANDed', () => {
    const r = applyFilter(dams, [
      { field: 'statusSlug', op: 'eq', value: 'xa_lu' },
      { field: 'ratedPower', op: 'gte', value: 200 },
    ]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập A']);
  });

  it('a missing/null property fails its condition without throwing', () => {
    const r = applyFilter([feat({ geographicalName: 'X' })], [{ field: 'ratedPower', op: 'gte', value: 1 }]);
    expect(r).toEqual([]);
  });

  it('a geometry-less feature can still match (list includes it)', () => {
    const r = applyFilter([feat({ statusSlug: 'xa_lu' }, null)], [{ field: 'statusSlug', op: 'eq', value: 'xa_lu' }]);
    expect(r).toHaveLength(1);
  });

  it('scale divides the feature value before comparing (metres stored, km entered)', () => {
    const rivers = [
      feat({ geographicalName: 'Sông dài', length: 11313 }),  // 11.3 km
      feat({ geographicalName: 'Suối ngắn', length: 1405 }),  // 1.4 km
    ];
    // "length >= 10 km" with scale 1000 -> compares raw/1000 >= 10
    const r = applyFilter(rivers, [{ field: 'length', op: 'gte', value: 10, scale: 1000 }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Sông dài']);
  });

  it('scale defaults to 1 (no division) when absent', () => {
    const r = applyFilter([feat({ length: 11313 })], [{ field: 'length', op: 'gte', value: 10000 }]);
    expect(r).toHaveLength(1); // raw 11313 >= 10000
  });

  it('eq is exact, not substring — xa_lu must not match xa_lu_khan_cap', () => {
    const feats = [
      { getProperties: () => ({ statusSlug: 'xa_lu_khan_cap' }), getGeometry: () => null },
      { getProperties: () => ({ statusSlug: 'xa_lu' }), getGeometry: () => null },
    ];
    const out = applyFilter(feats, [{ field: 'statusSlug', op: 'eq', value: 'xa_lu' }]);
    expect(out).toHaveLength(1);
    expect(out[0].getProperties().statusSlug).toBe('xa_lu');
  });

  it('eq ignores case and surrounding whitespace', () => {
    const feats = [{ getProperties: () => ({ riskLevel: ' Cao ' }), getGeometry: () => null }];
    expect(applyFilter(feats, [{ field: 'riskLevel', op: 'eq', value: 'cao' }])).toHaveLength(1);
  });

  it('contains is a case-insensitive substring match', () => {
    const feats = [{ getProperties: () => ({ geographicalName: 'Sông Ba' }), getGeometry: () => null }];
    expect(applyFilter(feats, [{ field: 'geographicalName', op: 'contains', value: 'ba' }])).toHaveLength(1);
    expect(applyFilter(feats, [{ field: 'geographicalName', op: 'contains', value: 'xyz' }])).toHaveLength(0);
  });

  it('returns ALL features when there are no conditions (display capping is the caller job)', () => {
    const feats = [
      { getProperties: () => ({ a: 1 }), getGeometry: () => null },
      { getProperties: () => ({ a: 2 }), getGeometry: () => null },
    ];
    expect(applyFilter(feats, [])).toHaveLength(2);
  });
});
