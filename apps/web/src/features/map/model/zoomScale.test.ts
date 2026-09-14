import { describe, it, expect } from 'vitest';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  MIN_SCALE,
  MAX_SCALE,
  ZOOM_SCALE_LEVELS,
  VIETNAM_EXTENT_4326,
  VIETNAM_CENTER_4326,
  INITIAL_CENTER_4326,
  INITIAL_ZOOM,
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

describe('khung nhìn khi mở ứng dụng', () => {
  // Đất liền vùng công tác (Nam Trung Bộ & Tây Nguyên), tính từ wards-region.geojson
  // sau khi loại các đỉnh ngoài khơi (>111°Đ): 107,206–110,648°Đ / 7,316–16,216°B.
  const LAND = { minLon: 107.206, maxLon: 110.648, minLat: 7.316, maxLat: 16.216 };

  it('tâm mở đầu nằm trong đất liền vùng công tác', () => {
    const [lon, lat] = INITIAL_CENTER_4326;
    expect(lon).toBeGreaterThan(LAND.minLon);
    expect(lon).toBeLessThan(LAND.maxLon);
    expect(lat).toBeGreaterThan(LAND.minLat);
    expect(lat).toBeLessThan(LAND.maxLat);
  });

  it('tâm mở đầu KHÔNG bị Hoàng Sa/Trường Sa kéo ra giữa Biển Đông', () => {
    // Nếu tính extent gộp cả đảo xa bờ, tâm sẽ rơi vào ~112,5°Đ — giữa biển.
    expect(INITIAL_CENTER_4326[0]).toBeLessThan(111);
  });

  it('zoom mở đầu phóng gần hơn MIN_ZOOM (nếu không thì bbox lại tải toàn quốc)', () => {
    expect(INITIAL_ZOOM).toBeGreaterThan(MIN_ZOOM);
  });

  it('zoom mở đầu vẫn nằm trong dải zoom cho phép', () => {
    expect(INITIAL_ZOOM).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(INITIAL_ZOOM).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it('khung nhìn mở đầu hẹp hơn khung ở MIN_ZOOM (điều kiện để bbox có tác dụng)', () => {
    // Đây là lý do tồn tại của INITIAL_ZOOM. Ở MIN_ZOOM khung rộng ~2.172 km,
    // bao trọn Việt Nam (854 km ngang), nên bbox buộc phải tải toàn bộ dữ liệu.
    // Khung lúc mở phải hẹp hơn rõ rệt thì bbox mới cắt bớt được.
    const initialWidthKm = (resolutionAtZoom(INITIAL_ZOOM, INITIAL_CENTER_4326[1]) * 1400) / 1000;
    const minZoomWidthKm = (resolutionAtZoom(MIN_ZOOM, VIETNAM_CENTER_4326[1]) * 1400) / 1000;
    expect(initialWidthKm).toBeLessThan(minZoomWidthKm);
  });

  it('khung nhìn mở đầu phủ trọn chiều Bắc–Nam của đất liền vùng công tác', () => {
    // Vùng cao 988 km; nếu khung thấp hơn, người dùng mở app sẽ thấy vùng bị cắt.
    const heightKm = (resolutionAtZoom(INITIAL_ZOOM, INITIAL_CENTER_4326[1]) * 900) / 1000;
    const regionHeightKm = (LAND.maxLat - LAND.minLat) * 111;
    expect(heightKm).toBeGreaterThan(regionHeightKm);
  });
});
