import { describe, it, expect } from 'vitest';
import { buildRegionRings, featureIntersectsRegion } from './regionClip.mjs';

// Hai ô vuông rời nhau, giả lập hai tỉnh.
const fakeProvinces = {
  type: 'FeatureCollection',
  features: [
    {
      properties: { code: '48', name: 'Tỉnh A' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
    },
    {
      properties: { code: '51', name: 'Tỉnh B' },
      geometry: { type: 'MultiPolygon', coordinates: [[[[5, 5], [7, 5], [7, 7], [5, 7], [5, 5]]]] },
    },
    {
      properties: { code: '99', name: 'Ngoài vùng' },
      geometry: { type: 'Polygon', coordinates: [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]] },
    },
  ],
};

const rings = buildRegionRings(fakeProvinces, ['48', '51']);

describe('regionClip', () => {
  it('chỉ dựng ranh giới từ các tỉnh được chỉ định', () => {
    expect(rings).toHaveLength(2);
  });

  it('báo lỗi rõ ràng khi thiếu mã tỉnh', () => {
    expect(() => buildRegionRings(fakeProvinces, ['48', '00'])).toThrow(/00/);
  });

  it('giữ điểm nằm trong vùng', () => {
    const f = { geometry: { type: 'Point', coordinates: [1, 1] } };
    expect(featureIntersectsRegion(f, rings)).toBe(true);
  });

  it('loại điểm nằm ngoài vùng', () => {
    const f = { geometry: { type: 'Point', coordinates: [21, 21] } };
    expect(featureIntersectsRegion(f, rings)).toBe(false);
  });

  it('giữ NGUYÊN VẸN đối tượng vắt ngang biên giới vùng', () => {
    // Đường bắt đầu trong tỉnh A, kết thúc bên ngoài — phải được giữ.
    const f = { geometry: { type: 'LineString', coordinates: [[1, 1], [50, 50]] } };
    expect(featureIntersectsRegion(f, rings)).toBe(true);
  });

  it('nhận diện qua bất kỳ đỉnh nào, kể cả đỉnh cuối', () => {
    const f = { geometry: { type: 'LineString', coordinates: [[50, 50], [40, 40], [6, 6]] } };
    expect(featureIntersectsRegion(f, rings)).toBe(true);
  });

  it('loại đối tượng hoàn toàn nằm ngoài', () => {
    const f = { geometry: { type: 'LineString', coordinates: [[30, 30], [40, 40]] } };
    expect(featureIntersectsRegion(f, rings)).toBe(false);
  });

  it('xử lý MultiPolygon lồng nhiều tầng', () => {
    const f = { geometry: { type: 'MultiPolygon', coordinates: [[[[6, 6], [6.5, 6], [6.5, 6.5], [6, 6]]]] } };
    expect(featureIntersectsRegion(f, rings)).toBe(true);
  });

  it('không vỡ khi feature thiếu geometry', () => {
    expect(featureIntersectsRegion({ geometry: null }, rings)).toBe(false);
    expect(featureIntersectsRegion({}, rings)).toBe(false);
  });
});
