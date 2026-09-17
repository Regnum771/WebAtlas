import { describe, it, expect } from 'vitest';
import { CRS_OPTIONS, DEFAULT_CRS_ID, findCrs } from './crs.js';

describe('CRS_OPTIONS', () => {
  it('has unique ids and a WGS84 default', () => {
    const ids = CRS_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findCrs(DEFAULT_CRS_ID).alias).toContain('WGS 84');
  });

  it('every TM-3 zone uses k=0.9999, false easting 500 km, and the meridian its alias names', () => {
    const tm3 = CRS_OPTIONS.filter((o) => o.id.startsWith('vn2000-tm3-'));
    expect(tm3.length).toBeGreaterThan(0);
    for (const o of tm3) {
      expect(o.proj4).toContain('+k=0.9999');
      expect(o.proj4).toContain('+x_0=500000');
      const [, deg, min] = o.alias.match(/KTT (\d+)°(\d+)′/)!;
      const lon0 = Number(o.proj4.match(/\+lon_0=([\d.]+)/)![1]);
      expect(lon0).toBeCloseTo(Number(deg) + Number(min) / 60, 6);
    }
  });

  it('falls back to the default for an unknown id', () => {
    expect(findCrs('nope').id).toBe(DEFAULT_CRS_ID);
  });
});
