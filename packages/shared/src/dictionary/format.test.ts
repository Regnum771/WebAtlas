import { describe, it, expect } from 'vitest';
import type { DictAttribute, Dictionary } from './types.js';
import { DICTIONARY } from './entries/index.js';
import { attributeOf, formatDisplayNumber, formatValue, labelFor, parseDisplay, toDisplayInput, valueName } from './format.js';

const volume: DictAttribute = {
  name: 'volume_mcm',
  source: 'column',
  valueType: 'number',
  label: 'Dung tích',
  definition: 'Dung tích hồ chứa.',
  storedUnit: 'm3',
  displayUnits: ['m3', '10*6.m3'],
  displayUnit: '10*6.m3',
  precision: 1,
  validFrom: '2026-01-01',
};

const level: DictAttribute = {
  name: 'risk_level',
  source: 'column',
  valueType: 'code',
  label: 'Mức rủi ro',
  definition: 'Mức rủi ro.',
  codeList: 'open',
  values: [{ code: 'Cao', name: 'Cao', order: 1 }],
  validFrom: '2026-01-01',
};

const area: DictAttribute = {
  name: 'area',
  source: 'column',
  valueType: 'text',
  label: 'Diện tích',
  definition: 'Diện tích kèm đơn vị.',
  validFrom: '2026-01-01',
};

const dictionary: Dictionary = {
  dams: {
    key: 'dams',
    kind: 'vector',
    name: 'Đập',
    definition: 'Đập.',
    crs: 4326,
    geometryType: 'Point',
    geometryMeaning: 'exact',
    validFrom: '2026-01-01',
    attributes: [volume],
  },
};

describe('format', () => {
  it('formatValue converts to the display unit and formats in vi-VN', () => {
    expect(formatValue(volume, 1_250_500_000)).toBe('1.250,5 triệu m³');
  });

  it('formatValue shows a dash for missing values', () => {
    for (const v of [null, undefined, NaN, Infinity, 'abc']) {
      expect(formatValue(volume, v)).toBe('—');
    }
  });

  it('formatValue accepts numeric strings from the database', () => {
    expect(formatValue(volume, '1250500000')).toBe('1.250,5 triệu m³');
    for (const v of ['  ', '', 'Infinity', 'NaN', '-Infinity']) {
      expect(formatValue(volume, v)).toBe('—');
    }
  });

  it('parseDisplay reads vi-VN numbers and converts back', () => {
    for (const text of ['1.250,5', '1.250,5 triệu m³']) {
      const r = parseDisplay(volume, text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBeCloseTo(1_250_500_000, 3);
    }
  });

  it('parseDisplay refuses ambiguous separators', () => {
    for (const text of ['1.5', '1,2,3']) {
      const r = parseDisplay(volume, text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('Dùng dấu phẩy');
    }
  });

  it('parseDisplay refuses a non-number attribute', () => {
    const r = parseDisplay(area, '1');
    expect(r).toEqual({ ok: false, message: 'Trường "Diện tích" không nhận giá trị số.' });
  });

  it('labelFor falls back to the raw name', () => {
    expect(labelFor(dictionary, 'dams', 'volume_mcm')).toBe('Dung tích');
    expect(labelFor(dictionary, 'dams', 'zzz')).toBe('zzz');
    expect(labelFor(dictionary, 'nope', 'zzz')).toBe('zzz');
    expect(attributeOf(dictionary, 'dams', 'zzz')).toBeUndefined();
  });

  it('valueName falls back to the code', () => {
    expect(valueName(level, 'Cao')).toBe('Cao');
    expect(valueName(level, 'Lạ')).toBe('Lạ');
  });

  it('a text value is shown as stored', () => {
    expect(formatValue(area, '22.8 km2')).toBe('22.8 km2');
  });

  const lengthM: DictAttribute = {
    name: 'length_m',
    source: 'column',
    valueType: 'number',
    label: 'Chiều dài',
    definition: 'Chiều dài.',
    storedUnit: 'm',
    displayUnits: ['km', 'm'],
    displayUnit: 'km',
    precision: 1,
    validFrom: '2026-01-01',
  };

  it('toDisplayInput keeps full precision in the display unit', () => {
    const text = toDisplayInput(lengthM, 12345.678);
    expect(text).toBe('12,345678');
    expect(parseDisplay(lengthM, text)).toEqual({ ok: true, value: 12345.678 });
    expect(toDisplayInput(lengthM, '12345.678')).toBe('12,345678');
  });

  it('parseDisplay gives clean stored values', () => {
    const annualOutput = attributeOf(DICTIONARY, 'dams', 'annual_output')!;
    const riverLength = attributeOf(DICTIONARY, 'rivers', 'length_m')!;
    expect(riverLength.displayUnit).toBe('km');
    expect(parseDisplay(annualOutput, '1,27')).toEqual({ ok: true, value: 1.27 });
    expect(parseDisplay(riverLength, '4,07')).toEqual({ ok: true, value: 4070 });
  });

  it("toDisplayInput gives '' for missing values", () => {
    for (const v of [null, undefined, NaN, Infinity, 'abc', '']) {
      expect(toDisplayInput(lengthM, v)).toBe('');
    }
  });

  it('toDisplayInput passes code, text and date through', () => {
    expect(toDisplayInput(level, 'Cao')).toBe('Cao');
    expect(toDisplayInput(area, '22.8 km2')).toBe('22.8 km2');
  });
});

describe('formatDisplayNumber', () => {
  it("formatDisplayNumber has no unit symbol and matches formatValue's number", () => {
    const attr: DictAttribute = {
      name: 'wattage_mw',
      source: 'column',
      valueType: 'number',
      label: 'Công suất',
      definition: 'Công suất.',
      storedUnit: 'MW',
      displayUnits: ['MW', 'kW'],
      displayUnit: 'kW',
      validFrom: '2026-01-01',
    };
    expect(formatDisplayNumber(attr, 200)).toBe('200.000');
    expect(formatValue(attr, 200)).toBe('200.000 kW');
    expect(formatDisplayNumber(attr, '1000')).toBe('1.000.000');
    expect(formatDisplayNumber(attr, null)).toBe('—');
    expect(formatDisplayNumber(attr, 'abc')).toBe('—');
  });
});
