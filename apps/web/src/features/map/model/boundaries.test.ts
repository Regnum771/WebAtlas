import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { REGION_PROVINCE_CODES } from '@webatlas/shared';

const publicDir = resolve(__dirname, '../../../../public');
const load = (name: string) =>
  JSON.parse(readFileSync(resolve(publicDir, name), 'utf8')) as {
    type: string;
    features: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }>;
  };

describe('ranh giới hành chính', () => {
  it('provinces-34.geojson có đúng 34 tỉnh sau sáp nhập', () => {
    const fc = load('provinces-34.geojson');
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(34);
  });

  it('mọi tỉnh đều có mã và tên', () => {
    const features = load('provinces-34.geojson').features;
    expect(features.length).toBeGreaterThan(0);
    for (const f of features) {
      expect(typeof f.properties.code).toBe('string');
      expect(typeof f.properties.name).toBe('string');
      expect((f.properties.name as string).length).toBeGreaterThan(0);
    }
  });

  it('6 tỉnh của vùng đều có mặt trong dữ liệu tỉnh', () => {
    const codes = new Set(load('provinces-34.geojson').features.map((f) => f.properties.code));
    for (const code of REGION_PROVINCE_CODES) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it('wards-region.geojson chỉ chứa xã thuộc 6 tỉnh trong vùng', () => {
    const fc = load('wards-region.geojson');
    expect(fc.features.length).toBeGreaterThan(0);
    const region = new Set<string>(REGION_PROVINCE_CODES);
    for (const f of fc.features) {
      expect(region.has(f.properties.provinceCode as string)).toBe(true);
    }
  });

  it('mọi tỉnh trong vùng đều có ít nhất một xã', () => {
    const seen = new Set(load('wards-region.geojson').features.map((f) => f.properties.provinceCode));
    for (const code of REGION_PROVINCE_CODES) {
      expect(seen.has(code)).toBe(true);
    }
  });

  it('toạ độ nằm trong phạm vi Việt Nam (EPSG:4326, lon/lat)', () => {
    const fc = load('provinces-34.geojson');
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    const walk = (n: any): void => {
      if (typeof n[0] === 'number') {
        minLon = Math.min(minLon, n[0]); maxLon = Math.max(maxLon, n[0]);
        minLat = Math.min(minLat, n[1]); maxLat = Math.max(maxLat, n[1]);
      } else n.forEach(walk);
    };
    fc.features.forEach((f) => walk(f.geometry.coordinates));
    // Bao gồm cả Hoàng Sa/Trường Sa nên biên đông vươn xa hơn đất liền.
    expect(minLon).toBeGreaterThan(100);
    expect(maxLon).toBeLessThan(120);
    expect(minLat).toBeGreaterThan(5);
    expect(maxLat).toBeLessThan(25);
  });

  it('dung lượng đủ nhỏ để nạp vào trình duyệt', () => {
    // Dữ liệu xã thô là 157 MB; đây là chốt chặn cho bước đơn giản hóa.
    const wardMb = statSync(resolve(publicDir, 'wards-region.geojson')).size / 1048576;
    const provinceMb = statSync(resolve(publicDir, 'provinces-34.geojson')).size / 1048576;
    expect(wardMb).toBeLessThan(20);
    expect(provinceMb).toBeLessThan(5);
  });
});
