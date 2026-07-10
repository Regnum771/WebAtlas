import { describe, it, expect } from 'vitest';
import { normalizeFeatureProperties } from './layer-attributes';
import type { LayerFeatureProperties, DamProperties } from './feature-properties';

describe('typed feature properties', () => {
  it('normalizeFeatureProperties returns a layerKey-discriminated type usable via narrowing', () => {
    const p: LayerFeatureProperties = normalizeFeatureProperties('dams', {
      id: 'u1', external_id: 1, name: 'Hoa Binh', wattage_mw: 1920,
    });
    expect(p.layerKey).toBe('dams');
    if (p.layerKey === 'dams') {
      const dam: DamProperties = p; // compiles only if the union narrows correctly
      expect(dam.ratedPower).toBe(1920);
      expect(dam.geographicalName).toBe('Hoa Binh');
    }
  });
});
