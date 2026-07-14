import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';
import { LAYER_ATTRIBUTE_MAP, normalizeFeatureProperties } from './layer-attributes';

describe('LAYER_ATTRIBUTE_MAP', () => {
  it('covers every editable layer key', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      expect(LAYER_ATTRIBUTE_MAP[key]).toBeDefined();
      expect(LAYER_ATTRIBUTE_MAP[key].wfsTypeName).toBe(`webatlas:${key}`);
    }
  });

  it('maps dam DB columns to ISO/INSPIRE names', () => {
    const a = LAYER_ATTRIBUTE_MAP.dams.attributes;
    expect(a.external_id).toBe('localId');
    expect(a.name).toBe('geographicalName');
    expect(a.wattage_mw).toBe('ratedPower');
    expect(a.year_operational).toBe('commissioningYear');
  });
});

describe('normalizeFeatureProperties', () => {
  it('renames known columns, keeps id, and stamps layerKey', () => {
    const out = normalizeFeatureProperties('dams', {
      id: 'uuid-1', external_id: 42, name: 'Hoa Binh', wattage_mw: 1920, status: null,
    });
    expect(out.localId).toBe(42);
    expect(out.geographicalName).toBe('Hoa Binh');
    expect(out.ratedPower).toBe(1920);
    expect(out.id).toBe('uuid-1');
    expect(out.layerKey).toBe('dams');
    // raw DB name is not leaked
    expect('wattage_mw' in out).toBe(false);
  });

  it('passes through unknown keys unchanged', () => {
    const out = normalizeFeatureProperties('rivers', { code: 'LA08', foo: 'bar' } as Record<string, unknown>);
    expect(out.hydroId).toBe('LA08');
    expect(out.foo).toBe('bar');
  });
});
