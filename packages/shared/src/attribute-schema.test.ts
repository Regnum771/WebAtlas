import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';
import { LAYER_FILTER_FIELDS } from './attribute-schema';

describe('LAYER_FILTER_FIELDS', () => {
  it('has at least one filter field for every editable layer', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      expect(LAYER_FILTER_FIELDS[key].length).toBeGreaterThan(0);
    }
  });

  it('every enum field lists its values', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      for (const f of LAYER_FILTER_FIELDS[key]) {
        if (f.type === 'enum') {
          expect(Array.isArray(f.enumValues)).toBe(true);
          expect(f.enumValues!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every field has an iso key, a label, and a valid type', () => {
    const types = ['enum', 'number', 'date', 'text'];
    for (const key of EDITABLE_LAYER_KEYS) {
      for (const f of LAYER_FILTER_FIELDS[key]) {
        expect(typeof f.iso).toBe('string');
        expect(f.iso.length).toBeGreaterThan(0);
        expect(typeof f.label).toBe('string');
        expect(types).toContain(f.type);
      }
    }
  });

  it('dams filters status on the stamped statusSlug, not the display label', () => {
    const statusField = LAYER_FILTER_FIELDS.dams.find((f) => f.type === 'enum' && f.iso === 'statusSlug');
    expect(statusField).toBeDefined();
    expect(statusField!.enumValues).toContain('xa_lu');
  });

  it('riskLevel is a Vietnamese enum (matches the real seed data, not low/medium/high)', () => {
    const rl = LAYER_FILTER_FIELDS.flood_zones.find((f) => f.iso === 'riskLevel');
    expect(rl?.type).toBe('enum');
    expect(rl?.enumValues).toContain('Cao');
    expect(rl?.enumValues).not.toContain('high');
  });

  it('labeled-string fields are text, not number (a numeric compare would fail on "4.2 g/l")', () => {
    const salinity = LAYER_FILTER_FIELDS.saltwater_intrusion.find((f) => f.iso === 'salinity');
    expect(salinity?.type).toBe('text');
    const year = LAYER_FILTER_FIELDS.dams.find((f) => f.iso === 'commissioningYear');
    expect(year?.type).toBe('text'); // "MM/YYYY" string
  });

  it('rivers Cấp sông (streamOrder) is an enum of Strahler orders 1..6, not a free number', () => {
    const order = LAYER_FILTER_FIELDS.rivers.find((f) => f.iso === 'streamOrder');
    expect(order?.type).toBe('enum');
    expect(order?.enumValues).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('rivers Chiều dài (length) filters in km via scale=1000, labelled in km', () => {
    const len = LAYER_FILTER_FIELDS.rivers.find((f) => f.iso === 'length');
    expect(len?.type).toBe('number');
    expect(len?.scale).toBe(1000); // feature stores metres; user enters km
    expect(len?.label).toMatch(/km/);
  });
});
