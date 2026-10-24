import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from '../../index.js';
import { LAYER_GEOMETRY } from '../../layer-geometry.js';
import { DAM_STATUS_DISPLAY, DAM_STATUS_SLUGS } from '../../dam-status.js';
import { validateDictionary } from '../validate.js';
import { attributeOf, formatValue } from '../format.js';
import { DICTIONARY } from './index.js';

describe('dictionary entries', () => {
  it('the dictionary validates', () => {
    expect(validateDictionary(DICTIONARY)).toEqual([]);
  });

  it('the eight editable layers are present', () => {
    expect(EDITABLE_LAYER_KEYS.every((k) => DICTIONARY[k])).toBe(true);
    for (const k of EDITABLE_LAYER_KEYS) {
      const ft = DICTIONARY[k];
      expect(ft.table).toBe(`water.${k}`);
      expect(ft.crs).toBe(4326);
      expect(ft.geometryType).toBe(LAYER_GEOMETRY[k]);
      expect(ft.validFrom).toBe('2026-10-24');
    }
  });

  it('dam status is closed and names come from dam-status', () => {
    const status = attributeOf(DICTIONARY, 'dams', 'status')!;
    expect(status.valueType).toBe('code');
    expect(status.codeList).toBe('closed');
    expect(status.values?.map((v) => v.code)).toEqual([...DAM_STATUS_SLUGS]);
    for (const v of status.values ?? []) {
      expect(v.name).toBe(DAM_STATUS_DISPLAY[v.code as keyof typeof DAM_STATUS_DISPLAY].label);
    }
  });

  it('volume is stored in million m³ and shown in triệu m³', () => {
    expect(formatValue(attributeOf(DICTIONARY, 'lakes', 'volume_mcm')!, 1250.5)).toBe('1.250,5 triệu m³');
  });
});
