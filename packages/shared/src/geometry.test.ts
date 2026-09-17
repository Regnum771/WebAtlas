import { describe, it, expect } from 'vitest';
import { isGeoJsonGeometry, countVertices, positionsOf } from './geometry.js';

describe('isGeoJsonGeometry', () => {
  it('accepts every supported type', () => {
    expect(isGeoJsonGeometry({ type: 'Point', coordinates: [108, 12] })).toBe(true);
    expect(isGeoJsonGeometry({ type: 'MultiPoint', coordinates: [[108, 12]] })).toBe(true);
    expect(isGeoJsonGeometry({ type: 'LineString', coordinates: [[108, 12], [108.1, 12.1]] })).toBe(true);
    expect(isGeoJsonGeometry({ type: 'MultiLineString', coordinates: [[[108, 12], [108.1, 12.1]]] })).toBe(true);
    expect(isGeoJsonGeometry({ type: 'Polygon', coordinates: [[[108, 12], [108.1, 12], [108.1, 12.1], [108, 12]]] })).toBe(true);
    expect(isGeoJsonGeometry({ type: 'MultiPolygon', coordinates: [[[[108, 12], [108.1, 12], [108.1, 12.1], [108, 12]]]] })).toBe(true);
  });

  it('rejects wrong nesting, non-finite and out-of-range coordinates', () => {
    expect(isGeoJsonGeometry({ type: 'Point', coordinates: [[108, 12]] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'LineString', coordinates: [[108, 12]] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'Point', coordinates: [NaN, 12] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'Point', coordinates: [200, 12] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'Point', coordinates: [108, 95] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'Polygon', coordinates: [[[108, 12], [108.1, 12], [108, 12]]] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'GeometryCollection', geometries: [] })).toBe(false);
    expect(isGeoJsonGeometry(null)).toBe(false);
  });
});

describe('countVertices / positionsOf', () => {
  it('counts every position of a multi geometry', () => {
    const g = { type: 'MultiLineString' as const, coordinates: [[[1, 1], [2, 2]], [[3, 3], [4, 4], [5, 5]]] };
    expect(countVertices(g)).toBe(5);
    expect(positionsOf(g)[4]).toEqual([5, 5]);
  });
});
