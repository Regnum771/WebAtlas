import { describe, it, expect } from 'vitest';
import { UNITS, unit, convert, unitsOfDimension, commonConversions } from './units.js';

describe('units', () => {
  it('converts within a dimension', () => {
    expect(convert(1, 'km2', 'ha')).toBe(100);
    expect(convert(5_000_000, 'm3', '10*6.m3')).toBe(5);
    expect(Math.abs(convert(1, 'm3/s', '10*6.m3/d') - 0.0864)).toBeLessThan(1e-9);
  });

  it('refuses across dimensions', () => {
    expect(() => convert(1, 'MW', 'm3')).toThrow('Cannot convert MW to m3');
  });

  it('offset units round-trip', () => {
    expect(Math.abs(convert(300, 'K', 'Cel') - 26.85)).toBeLessThan(1e-9);
    expect(convert(convert(12.34, 'Cel', 'K'), 'K', 'Cel').toFixed(2)).toBe('12.34');
  });

  it('model precipitation flux converts to mm per day', () => {
    expect(Math.abs(convert(1 / 86400, 'kg/(m2.s)', 'mm/d') - 1)).toBeLessThan(1e-9);
  });

  it('unknown unit throws', () => {
    expect(() => unit('furlong')).toThrow('Unknown unit furlong');
  });

  it('convert between equal units returns the value unchanged', () => {
    for (const v of [1.27, 0.1, 29.74, 4070.0000001, -3.3]) {
      expect(convert(v, 'GW.h/a', 'GW.h/a')).toBe(v);
      expect(convert(v, 'Cel', 'Cel')).toBe(v);
    }
  });

  it('annual energy output converts to MW', () => {
    expect(Math.abs(convert(8.766, 'GW.h/a', 'MW') - 1)).toBeLessThan(1e-9);
  });

  it('common conversions list the other units of the dimension', () => {
    expect(commonConversions('km2')).toContainEqual({ to: 'ha', factor: 100 });
    expect(commonConversions('Cel')).toEqual([]);
    expect(unitsOfDimension('area').map((u) => u.code)).toEqual(['m2', 'km2', 'ha']);
  });

  it('every unit has a symbol and a positive factor', () => {
    for (const [code, def] of Object.entries(UNITS)) {
      expect(def.code).toBe(code);
      expect(def.factor).toBeGreaterThan(0);
      if (code !== '1') expect(def.symbol.length).toBeGreaterThan(0);
    }
  });
});
