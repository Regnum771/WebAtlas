import { describe, it, expect } from 'vitest';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  MIN_SCALE,
  MAX_SCALE,
  ZOOM_SCALE_LEVELS,
  VIETNAM_EXTENT_4326,
  scaleAtZoom,
  zoomForScale,
  resolutionAtZoom,
  formatScale,
} from './zoomScale';

describe('zoomScale', () => {
  it('quy đổi zoom <-> tỷ lệ là nghịch đảo của nhau', () => {
    for (const scale of [100_000, 500_000, 1_750_000, 7_100_000]) {
      expect(scaleAtZoom(zoomForScale(scale))).toBeCloseTo(scale, 3);
    }
  });

  it('MIN_ZOOM/MAX_ZOOM ứng đúng với tỷ lệ yêu cầu', () => {
    // Phóng to hết cỡ = 1:100.000, thu nhỏ hết cỡ = 1:7.100.000.
    expect(scaleAtZoom(MAX_ZOOM)).toBeCloseTo(MAX_SCALE, 3);
    expect(scaleAtZoom(MIN_ZOOM)).toBeCloseTo(MIN_SCALE, 3);
    expect(MIN_ZOOM).toBeLessThan(MAX_ZOOM);
  });

  it('ở mức thu nhỏ nhất, toàn bộ Việt Nam lọt vào khung nhìn cao 900px', () => {
    const [, minLat, , maxLat] = VIETNAM_EXTENT_4326;
    // Xấp xỉ chiều cao Bắc-Nam theo mét (1 độ vĩ ~ 111.320 m).
    const spanMetres = (maxLat - minLat) * 111_320;
    const heightPx = spanMetres / resolutionAtZoom(MIN_ZOOM);
    expect(heightPx).toBeLessThanOrEqual(900);
  });

  it('mỗi nấc trên slider phóng to dần và nằm trong khoảng min/max', () => {
    const zooms = ZOOM_SCALE_LEVELS.map((s) => zoomForScale(s));
    for (let i = 1; i < zooms.length; i++) {
      expect(zooms[i]).toBeGreaterThan(zooms[i - 1]);
    }
    for (const z of zooms) {
      expect(z).toBeGreaterThanOrEqual(MIN_ZOOM - 0.001);
      expect(z).toBeLessThanOrEqual(MAX_ZOOM + 0.001);
    }
  });

  it('hai nấc đầu/cuối trùng đúng với giới hạn thu/phóng', () => {
    expect(ZOOM_SCALE_LEVELS[0]).toBe(MIN_SCALE);
    expect(ZOOM_SCALE_LEVELS[ZOOM_SCALE_LEVELS.length - 1]).toBe(MAX_SCALE);
  });

  it('định dạng nhãn tỷ lệ theo kiểu Việt Nam', () => {
    expect(formatScale(100_000)).toBe('1:100.000');
    expect(formatScale(1_750_000)).toBe('1:1.750.000');
  });
});
