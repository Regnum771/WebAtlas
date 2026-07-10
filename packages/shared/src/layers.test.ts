import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';

describe('EDITABLE_LAYER_KEYS', () => {
  it('lists exactly the seven thematic water/hazard layers', () => {
    expect(EDITABLE_LAYER_KEYS).toHaveLength(7);
  });

  it('includes the dams and rivers layers', () => {
    expect(EDITABLE_LAYER_KEYS).toContain('dams');
    expect(EDITABLE_LAYER_KEYS).toContain('rivers');
  });

  it('contains no duplicate keys', () => {
    expect(new Set(EDITABLE_LAYER_KEYS).size).toBe(EDITABLE_LAYER_KEYS.length);
  });

  it('is exactly the seven canonical keys in order', () => {
    expect([...EDITABLE_LAYER_KEYS]).toEqual([
      'dams',
      'rivers',
      'stations',
      'flood_zones',
      'drought_points',
      'saltwater_intrusion',
      'flood_generation',
    ]);
  });
});
