import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';
import { LAYER_ATTRIBUTE_MAP, normalizeFeatureProperties, denormalizeFeatureProperties } from './layer-attributes';

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

describe('denormalizeFeatureProperties', () => {
  it('renames ISO names back to DB columns and drops layerKey', () => {
    const out = denormalizeFeatureProperties('dams', {
      layerKey: 'dams', geographicalName: 'Hoa Binh', ratedPower: 1920, commissioningYear: '1994',
    });
    expect(out.name).toBe('Hoa Binh');
    expect(out.wattage_mw).toBe(1920);
    expect(out.year_operational).toBe('1994');
    expect('layerKey' in out).toBe(false);
    // ISO names are not leaked
    expect('geographicalName' in out).toBe(false);
  });

  it('round-trips normalize -> denormalize for every editable layer', () => {
    const samples: Record<string, Record<string, unknown>> = {
      dams: { name: 'A', wattage_mw: 10, status: 'active' },
      rivers: { name: 'R', code: 'LA08', stream_order: 3 },
      stations: { name: 'S', station_type: 't', value: '1.2' },
      flood_zones: { name: 'F', hazard_type: 'h', risk_level: 'high' },
      drought_points: { name: 'D', risk_level: 'low', survey_date: '2024-01-01' },
      saltwater_intrusion: { name: 'Salt', salinity: '2', risk_level: 'med' },
      flood_generation: { name: 'FG', risk_level: 'high', flow_rate: 'fast' },
    };
    for (const key of EDITABLE_LAYER_KEYS) {
      const db = samples[key];
      const iso = normalizeFeatureProperties(key, db);
      const back = denormalizeFeatureProperties(key, iso as Record<string, unknown>);
      expect(back).toEqual(db);
    }
  });

  it('passes id and unknown keys through unchanged', () => {
    const out = denormalizeFeatureProperties('rivers', { id: 'uuid-9', hydroId: 'LA08', foo: 'bar' });
    expect(out.id).toBe('uuid-9');
    expect(out.code).toBe('LA08');
    expect(out.foo).toBe('bar');
  });
});
