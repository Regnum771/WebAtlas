import { describe, it, expect } from 'vitest';
import type { DictAttribute, DictFeatureType, Dictionary } from './types.js';
import { validateDictionary } from './validate.js';

function attr(over: Partial<DictAttribute> = {}): DictAttribute {
  return {
    name: 'volume_mcm',
    source: 'column',
    valueType: 'number',
    label: 'Dung tích',
    definition: 'Dung tích.',
    storedUnit: 'm3',
    displayUnits: ['m3', '10*6.m3'],
    displayUnit: '10*6.m3',
    precision: 1,
    validFrom: '2026-01-01',
    ...over,
  };
}

function dict(a: DictAttribute): Dictionary {
  const ft: DictFeatureType = {
    key: 'dams',
    kind: 'vector',
    name: 'Đập',
    definition: 'Đập.',
    crs: 4326,
    geometryType: 'Point',
    geometryMeaning: 'exact',
    validFrom: '2026-01-01',
    attributes: [a],
  };
  return { dams: ft };
}

describe('validateDictionary', () => {
  it('a valid fixture has no problems', () => {
    expect(validateDictionary(dict(attr()))).toEqual([]);
  });

  it('a text attribute with a stored unit is a validation problem', () => {
    const p = validateDictionary(dict(attr({ valueType: 'text' })));
    expect(p.length).toBeGreaterThan(0);
    expect(p.join('\n')).toContain('volume_mcm');
  });

  it('a display unit of another dimension is a problem', () => {
    const p = validateDictionary(dict(attr({ displayUnits: ['m3', 'km2'], displayUnit: 'm3' })));
    expect(p.join('\n')).toContain('km2');
  });

  it('a code attribute without values is a problem', () => {
    const a = attr({ valueType: 'code', storedUnit: undefined, displayUnits: undefined, displayUnit: undefined, precision: undefined });
    expect(validateDictionary(dict(a)).length).toBeGreaterThan(0);
  });

  it('displayUnit outside displayUnits is a problem', () => {
    const p = validateDictionary(dict(attr({ displayUnits: ['m3'], displayUnit: '10*6.m3' })));
    expect(p.join('\n')).toContain('displayUnit');
  });

  it('flags structural problems', () => {
    const d = dict(attr({ precision: 9, validFrom: '2026-02-01', validTo: '2026-01-01' }));
    const bad = { wrong: { ...d.dams, crs: 1234, geometryType: undefined } } as unknown as Dictionary;
    const text = validateDictionary(bad).join('\n');
    expect(text).toContain('key');
    expect(text).toContain('crs');
    expect(text).toContain('geometryType');
    expect(text).toContain('precision');
    expect(text).toContain('validTo');
  });
});
