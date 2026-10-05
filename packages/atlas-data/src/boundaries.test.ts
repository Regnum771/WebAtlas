import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { REGION_PROVINCE_CODES } from '@webatlas/shared';
import { resolveStageFile } from './paths';

const pathOf = (name: string) => resolveStageFile({ file: `seeds/${name}` });
const load = (name: string) =>
  JSON.parse(readFileSync(pathOf(name), 'utf8')) as {
    type: string;
    features: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }>;
  };

describe('the administrative boundary files', () => {
  it('provinces-34.geojson holds exactly the 34 provinces after the merger', () => {
    const fc = load('provinces-34.geojson');
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(34);
  });

  it('every province has a code and a name', () => {
    const features = load('provinces-34.geojson').features;
    expect(features.length).toBeGreaterThan(0);
    for (const f of features) {
      expect(typeof f.properties.code).toBe('string');
      expect(typeof f.properties.name).toBe('string');
      expect((f.properties.name as string).length).toBeGreaterThan(0);
    }
  });

  it('the six provinces of the working region are in the province file', () => {
    const codes = new Set(load('provinces-34.geojson').features.map((f) => f.properties.code));
    for (const code of REGION_PROVINCE_CODES) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it('wards-region.geojson holds only wards of the six region provinces', () => {
    const fc = load('wards-region.geojson');
    expect(fc.features.length).toBeGreaterThan(0);
    const region = new Set<string>(REGION_PROVINCE_CODES);
    for (const f of fc.features) {
      expect(region.has(f.properties.provinceCode as string)).toBe(true);
    }
  });

  it('every region province has at least one ward', () => {
    const seen = new Set(load('wards-region.geojson').features.map((f) => f.properties.provinceCode));
    for (const code of REGION_PROVINCE_CODES) {
      expect(seen.has(code)).toBe(true);
    }
  });

  it('coordinates lie within Vietnam (EPSG:4326, lon/lat)', () => {
    const fc = load('provinces-34.geojson');
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    const walk = (n: any): void => {
      if (typeof n[0] === 'number') {
        minLon = Math.min(minLon, n[0]); maxLon = Math.max(maxLon, n[0]);
        minLat = Math.min(minLat, n[1]); maxLat = Math.max(maxLat, n[1]);
      } else n.forEach(walk);
    };
    fc.features.forEach((f) => walk(f.geometry.coordinates));
    // Hoàng Sa and Trường Sa are included, so the eastern edge reaches beyond the mainland.
    expect(minLon).toBeGreaterThan(100);
    expect(maxLon).toBeLessThan(120);
    expect(minLat).toBeGreaterThan(5);
    expect(maxLat).toBeLessThan(25);
  });

  it('the files stay small enough to keep in git', () => {
    // The raw ward data is 157 MB; this is the guard on fetch-boundaries.mjs's simplification step.
    const wardMb = statSync(pathOf('wards-region.geojson')).size / 1048576;
    const provinceMb = statSync(pathOf('provinces-34.geojson')).size / 1048576;
    expect(wardMb).toBeLessThan(20);
    expect(provinceMb).toBeLessThan(5);
  });
});
