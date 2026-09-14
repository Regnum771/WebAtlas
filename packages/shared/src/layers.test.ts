import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';

describe('EDITABLE_LAYER_KEYS', () => {
  it('has 8 editable layers', () => {
    expect(EDITABLE_LAYER_KEYS).toHaveLength(8);
  });

  it('contains lakes', () => {
    expect(EDITABLE_LAYER_KEYS).toContain('lakes');
  });

  it('includes the dams and rivers layers', () => {
    expect(EDITABLE_LAYER_KEYS).toContain('dams');
    expect(EDITABLE_LAYER_KEYS).toContain('rivers');
  });

  it('contains no duplicate keys', () => {
    expect(new Set(EDITABLE_LAYER_KEYS).size).toBe(EDITABLE_LAYER_KEYS.length);
  });

  it('is exactly the eight canonical keys in order', () => {
    expect([...EDITABLE_LAYER_KEYS]).toEqual([
      'dams',
      'rivers',
      'lakes',
      'stations',
      'flood_zones',
      'drought_points',
      'saltwater_intrusion',
      'flood_generation',
    ]);
  });
});
