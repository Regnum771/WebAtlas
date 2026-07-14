import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';
import { LAYER_GEOMETRY } from './layer-geometry';

describe('LAYER_GEOMETRY', () => {
  it('has an entry for every editable layer key', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      expect(LAYER_GEOMETRY[key]).toBeDefined();
    }
  });
  it('maps the known geometry types', () => {
    expect(LAYER_GEOMETRY.dams).toBe('Point');
    expect(LAYER_GEOMETRY.rivers).toBe('MultiLineString');
    expect(LAYER_GEOMETRY.flood_zones).toBe('MultiPolygon');
    expect(LAYER_GEOMETRY.flood_generation).toBe('MultiPolygon');
    expect(LAYER_GEOMETRY.stations).toBe('Point');
    expect(LAYER_GEOMETRY.drought_points).toBe('Point');
    expect(LAYER_GEOMETRY.saltwater_intrusion).toBe('Point');
  });
});
