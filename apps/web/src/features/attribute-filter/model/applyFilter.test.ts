import { describe, it, expect } from 'vitest';
import { applyFilter, type FeatureLike, type Condition } from './applyFilter';

function feat(props: Record<string, unknown>, geom: unknown = { type: 'Point' }): FeatureLike {
  return { getProperties: () => props, getGeometry: () => geom };
}

describe('applyFilter', () => {
  const dams = [
    feat({ geographicalName: 'Đập A', statusSlug: 'xa_lu', ratedPower: 250 }),
    feat({ geographicalName: 'Đập B', statusSlug: 'binh_thuong', ratedPower: 100 }),
    feat({ geographicalName: 'Hồ C', statusSlug: 'xa_lu', ratedPower: 50 }),
  ];

  it('empty conditions -> empty result (no filter means no list)', () => {
    expect(applyFilter(dams, [])).toEqual([]);
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

  it('text eq is case-insensitive substring', () => {
    const r = applyFilter(dams, [{ field: 'geographicalName', op: 'eq', value: 'đập' }]);
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
});
