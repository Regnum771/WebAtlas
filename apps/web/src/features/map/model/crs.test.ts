import { describe, it, expect } from 'vitest';
import { formatCoordinate, projectLonLat, toDms } from './crs';

const BMT = [108.05, 12.68];
const EXPECTED_UTM48 = { e: 831110.7330597674, n: 1403796.862511676 };
const EXPECTED_TM3 = { e: 450929.7985109486, n: 1402325.2109823804 };

describe('CRS formatting', () => {
  it('WGS84 decimal degrees keeps the existing readout format', () => {
    expect(formatCoordinate(BMT, 'wgs84-dd')).toBe('108.050000°E  12.680000°N');
  });

  it('formats degrees-minutes-seconds', () => {
    expect(toDms(108.05, 'E', 'W')).toBe('108°03′00.0″E');
  });

  it('matches PostGIS for VN-2000 / UTM 48N within 0.5 m', () => {
    const [e, n] = projectLonLat(BMT, 'vn2000-utm48');
    expect(Math.abs(e - EXPECTED_UTM48.e)).toBeLessThan(0.5);
    expect(Math.abs(n - EXPECTED_UTM48.n)).toBeLessThan(0.5);
  });

  it('matches PostGIS for VN-2000 / Đắk Lắk TM-3 within 0.5 m', () => {
    const [e, n] = projectLonLat(BMT, 'vn2000-tm3-dak-lak');
    expect(Math.abs(e - EXPECTED_TM3.e)).toBeLessThan(0.5);
    expect(Math.abs(n - EXPECTED_TM3.n)).toBeLessThan(0.5);
  });

  it('labels projected output with X (Bắc) / Y (Đông), the Vietnamese survey convention', () => {
    expect(formatCoordinate(BMT, 'vn2000-utm48')).toMatch(/^X: [\d.]+,\d{2} m {2}Y: [\d.]+,\d{2} m$/);
  });

  it('returns an empty string without a coordinate', () => {
    expect(formatCoordinate(undefined, 'wgs84-dd')).toBe('');
  });
});
