import { describe, it, expect } from 'vitest';
import { simplifyGeometry, roundCoords, countPoints } from './simplify.mjs';

// Vòng vuông với nhiều điểm thừa nằm thẳng hàng trên mỗi cạnh.
function squareWithRedundantPoints() {
  const ring = [];
  for (let i = 0; i <= 10; i++) ring.push([i / 10, 0]);
  for (let i = 1; i <= 10; i++) ring.push([1, i / 10]);
  for (let i = 9; i >= 0; i--) ring.push([i / 10, 1]);
  for (let i = 9; i >= 0; i--) ring.push([0, i / 10]);
  return { type: 'Polygon', coordinates: [ring] };
}

describe('simplify', () => {
  it('bỏ điểm thừa thẳng hàng nhưng giữ hình dạng', () => {
    const geom = squareWithRedundantPoints();
    const before = countPoints(geom);
    const out = simplifyGeometry(geom, 0.0001);
    expect(countPoints(out)).toBeLessThan(before / 4);
    // 4 góc vuông phải còn nguyên
    expect(countPoints(out)).toBeGreaterThanOrEqual(5);
  });

  it('giữ vòng khép kín sau khi đơn giản hóa', () => {
    const out = simplifyGeometry(squareWithRedundantPoints(), 0.0001);
    const ring = out.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('không bao giờ tạo vòng dưới 4 điểm (polygon hợp lệ)', () => {
    // Tolerance rất lớn: nếu không có chặn dưới sẽ thành vòng 2 điểm.
    const out = simplifyGeometry(squareWithRedundantPoints(), 10);
    expect(out.coordinates[0].length).toBeGreaterThanOrEqual(4);
  });

  it('xử lý MultiPolygon giữ nguyên cấu trúc lồng nhau', () => {
    const geom = {
      type: 'MultiPolygon',
      coordinates: [squareWithRedundantPoints().coordinates, squareWithRedundantPoints().coordinates],
    };
    const out = simplifyGeometry(geom, 0.0001);
    expect(out.type).toBe('MultiPolygon');
    expect(out.coordinates).toHaveLength(2);
    expect(Array.isArray(out.coordinates[0][0][0])).toBe(true);
  });

  it('xử lý LineString (không khép kín) không thêm điểm', () => {
    const geom = { type: 'LineString', coordinates: [[0, 0], [0.5, 0.00001], [1, 0]] };
    const out = simplifyGeometry(geom, 0.001);
    expect(out.coordinates).toHaveLength(2);
  });

  it('roundCoords làm tròn đúng số chữ số', () => {
    const geom = { type: 'Point', coordinates: [108.123456789, 12.987654321] };
    const out = roundCoords(geom, 5);
    expect(out.coordinates).toEqual([108.12346, 12.98765]);
  });

  it('không sửa geometry gốc (immutable)', () => {
    const geom = squareWithRedundantPoints();
    const before = countPoints(geom);
    simplifyGeometry(geom, 0.0001);
    roundCoords(geom, 5);
    expect(countPoints(geom)).toBe(before);
  });
});
