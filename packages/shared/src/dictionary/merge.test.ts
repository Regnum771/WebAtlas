import { describe, it, expect } from 'vitest';
import type { DictFeatureType, Dictionary } from './types.js';
import { mergeDictionary } from './merge.js';

function ft(key: string, name: string): DictFeatureType {
  return {
    key,
    kind: 'vector',
    name,
    definition: '',
    crs: 4326,
    geometryType: 'Point',
    geometryMeaning: 'exact',
    validFrom: '2026-01-01',
    attributes: [],
  };
}

const defaults: Dictionary = { a: ft('a', 'A mặc định'), b: ft('b', 'B mặc định') };

describe('mergeDictionary', () => {
  it('served feature types replace defaults and defaults fill the rest', () => {
    const merged = mergeDictionary(defaults, [ft('a', 'A phục vụ'), ft('c', 'C phục vụ')]);
    expect(merged.a.name).toBe('A phục vụ');
    expect(merged.b.name).toBe('B mặc định');
    expect(merged.c.name).toBe('C phục vụ');
  });

  it('no served list returns the defaults', () => {
    expect(mergeDictionary(defaults)).toBe(defaults);
  });
});
