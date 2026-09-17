import { describe, it, expect } from 'vitest';
import type { GeoJsonGeometry } from '@webatlas/shared';
import { DEFAULT_PARAMS, acceptsShape, buildInput, drawKindFor } from './tools';

const point: GeoJsonGeometry = { type: 'Point', coordinates: [108.05, 12.68] };
const line: GeoJsonGeometry = { type: 'LineString', coordinates: [[108, 12], [108.1, 12.1]] };
const poly: GeoJsonGeometry = { type: 'Polygon', coordinates: [[[108, 12], [108.1, 12], [108.1, 12.1], [108, 12]]] };

describe('analysis tool rules', () => {
  it('picks the draw kind per operation', () => {
    expect(drawKindFor('buffer', { ...DEFAULT_PARAMS, shape: 'LineString' })).toBe('LineString');
    expect(drawKindFor('select_within', DEFAULT_PARAMS)).toBe('Polygon');
    expect(drawKindFor('nearest', DEFAULT_PARAMS)).toBe('Point');
    expect(drawKindFor('elevation_profile', DEFAULT_PARAMS)).toBe('LineString');
    expect(drawKindFor('zonal_elevation', DEFAULT_PARAMS)).toBe('Polygon');
  });

  it('accepts a reused shape only when it fits the operation', () => {
    expect(acceptsShape('buffer', DEFAULT_PARAMS, line)).toBe(true);
    expect(acceptsShape('select_within', DEFAULT_PARAMS, line)).toBe(false);
    expect(acceptsShape('zonal_elevation', DEFAULT_PARAMS, poly)).toBe(true);
    expect(acceptsShape('nearest', DEFAULT_PARAMS, poly)).toBe(false);
  });

  it('builds the request body each route expects', () => {
    expect(buildInput('buffer', DEFAULT_PARAMS, point)).toEqual({ geometry: point, radiusKm: 5 });
    expect(buildInput('select_within', DEFAULT_PARAMS, poly)).toEqual({ geometry: poly, layerKeys: ['dams'] });
    expect(buildInput('nearest', DEFAULT_PARAMS, point)).toEqual({ lon: 108.05, lat: 12.68, layerKey: 'dams', k: 5 });
    expect(buildInput('elevation_profile', DEFAULT_PARAMS, line)).toEqual({ geometry: line, samples: 100 });
    expect(buildInput('zonal_elevation', DEFAULT_PARAMS, poly)).toEqual({ geometry: poly });
  });
});
