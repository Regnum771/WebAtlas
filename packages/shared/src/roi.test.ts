import { describe, it, expect } from 'vitest';
import { REFERENCE_LAYER_KEYS, withRadius, type Roi } from './roi.js';

describe('withRadius', () => {
  const river: Roi = { source: 'feature', layerKey: 'rivers', featureId: 'f', whole: true };

  it('sets a radius', () => {
    expect(withRadius(river, 5)).toEqual({ ...river, radiusKm: 5 });
  });

  it('removes a radius, returning the original line or point', () => {
    expect(withRadius({ ...river, radiusKm: 5 }, null)).toEqual(river);
  });

  it('never gives an admin unit a radius: it is already an area', () => {
    const province: Roi = { source: 'admin', level: 'province', code: '66' };
    expect(withRadius(province, 5)).toBe(province);
  });
});

describe('REFERENCE_LAYER_KEYS', () => {
  it('lists the five basemap reference layers', () => {
    expect(REFERENCE_LAYER_KEYS).toEqual(['roads', 'railways', 'water', 'landuse', 'places']);
  });
});
