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
});
