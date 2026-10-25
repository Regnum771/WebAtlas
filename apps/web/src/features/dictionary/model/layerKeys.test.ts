import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS, LAYER_ATTRIBUTE_MAP, DICTIONARY } from '@webatlas/shared';
import { LAYER_DICTIONARY_KEYS, dictionaryKeyFor } from './layerKeys';

describe('LAYER_DICTIONARY_KEYS', () => {
  it('every editable layer row maps to its dictionary key', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      expect(dictionaryKeyFor(LAYER_ATTRIBUTE_MAP[key].layerStateId)).toBe(key);
    }
  });

  it('maps the verified non-editable rows', () => {
    expect(dictionaryKeyFor('layer_provinces_2026')).toBe('provinces');
    expect(dictionaryKeyFor('layer_wards_2026')).toBe('wards');
    expect(dictionaryKeyFor('layer_contours')).toBe('contours');
    expect(dictionaryKeyFor('layer_bm_water')).toBe('osm_water');
  });

  it('a row without an entry has no key', () => {
    expect(dictionaryKeyFor('layer_bm_roads')).toBeNull();
    expect(dictionaryKeyFor('nope')).toBeNull();
  });

  it('every mapped key exists in the dictionary', () => {
    for (const key of Object.values(LAYER_DICTIONARY_KEYS)) expect(DICTIONARY[key]).toBeDefined();
  });
});
