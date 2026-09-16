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
  ZOOM_STOPS,
  nearestStopIndex,
  snapScaleForReadout,
  SIGNIFICANT_DIGITS,
  settleZoomCorrection,
  scaleAtResolution,
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

describe('ZOOM_STOPS', () => {
  it('has one zoom per scale stop, ascending (index 0 is the most zoomed out)', () => {
    expect(ZOOM_STOPS).toHaveLength(ZOOM_SCALE_LEVELS.length);
    for (let i = 1; i < ZOOM_STOPS.length; i++) {
      expect(ZOOM_STOPS[i]).toBeGreaterThan(ZOOM_STOPS[i - 1]);
    }
  });

  it('index i is the zoom for scale stop i — the slider relies on this alignment', () => {
    ZOOM_SCALE_LEVELS.forEach((scale, i) => {
      expect(ZOOM_STOPS[i]).toBeCloseTo(zoomForScale(scale), 10);
    });
  });
});

describe('nearestStopIndex', () => {
  it('returns the first stop below MIN_ZOOM', () => {
    expect(nearestStopIndex(MIN_ZOOM - 5)).toBe(0);
  });

  it('returns the last stop above MAX_ZOOM', () => {
    expect(nearestStopIndex(MAX_ZOOM + 5)).toBe(ZOOM_STOPS.length - 1);
  });

  it('returns that stop exactly on a stop', () => {
    ZOOM_STOPS.forEach((z, i) => expect(nearestStopIndex(z)).toBe(i));
  });

  it('picks the closer of two neighbours', () => {
    const justAboveFirst = ZOOM_STOPS[0] + (ZOOM_STOPS[1] - ZOOM_STOPS[0]) * 0.1;
    expect(nearestStopIndex(justAboveFirst)).toBe(0);
    const justBelowSecond = ZOOM_STOPS[0] + (ZOOM_STOPS[1] - ZOOM_STOPS[0]) * 0.9;
    expect(nearestStopIndex(justBelowSecond)).toBe(1);
  });
});

describe('snapScaleForReadout', () => {
  it('rounds to three significant figures, not to a fixed grid', () => {
    // A fixed 1.000 grid was fine when the range stopped at 1:100.000 (a 1%
    // step) but is a 4% step at 1:25.000 — visibly chunky at the close end.
    // Three significant figures is proportional, so the step feels the same
    // everywhere in the range.
    expect(snapScaleForReadout(1_247_331)).toBe(1_250_000);
    expect(snapScaleForReadout(26_431)).toBe(26_400);
    expect(snapScaleForReadout(9_871_234)).toBe(9_870_000);
  });

  it('is idempotent — the property the settle-snap loop guard depends on', () => {
    const once = snapScaleForReadout(1_247_331);
    expect(snapScaleForReadout(once)).toBe(once);
  });

  it('clamps rather than snapping past MAX_SCALE (most zoomed in)', () => {
    expect(snapScaleForReadout(20_000)).toBe(MAX_SCALE);
  });

  it('clamps rather than snapping past MIN_SCALE (most zoomed out)', () => {
    expect(snapScaleForReadout(15_000_000)).toBe(MIN_SCALE);
  });

  it('leaves every slider stop untouched — the two snappings must not fight', () => {
    // Fails the day someone adds a stop that is not a 3-significant-figure
    // value, which would otherwise show up only as a slider handle drifting
    // off its own notch after settling.
    ZOOM_SCALE_LEVELS.forEach((scale) => {
      expect(snapScaleForReadout(scale)).toBe(scale);
    });
    expect(SIGNIFICANT_DIGITS).toBe(3);
  });
});

describe('settleZoomCorrection', () => {
  it('corrects a zoom whose scale is not a round readout value', () => {
    // A zoom deliberately between stops, the state the wheel leaves the map in.
    const messy = zoomForScale(1_247_331);
    const corrected = settleZoomCorrection(messy);
    expect(corrected).not.toBeNull();
    expect(scaleAtZoom(corrected as number)).toBeCloseTo(1_250_000, 0);
  });

  it('returns null the second time — the loop guard that stops the map oscillating', () => {
    // MapModel applies the correction inside a moveend handler, which fires
    // another moveend. If this second call returned a correction too, the map
    // would jitter forever after every wheel stop.
    const corrected = settleZoomCorrection(zoomForScale(1_247_331)) as number;
    expect(settleZoomCorrection(corrected)).toBeNull();
  });

  it('returns null on every slider stop, so the two snappings never fight', () => {
    ZOOM_STOPS.forEach((z) => expect(settleZoomCorrection(z)).toBeNull());
  });

  it('returns null at the zoom bounds rather than pushing past them', () => {
    expect(settleZoomCorrection(MIN_ZOOM)).toBeNull();
    expect(settleZoomCorrection(MAX_ZOOM)).toBeNull();
  });
});

describe('scaleAtResolution', () => {
  it('agrees with scaleAtZoom for the same view — one scale vocabulary, not two', () => {
    // resolutionAtZoom returns GROUND resolution (already cos-corrected), so the
    // equivalent OL/3857 resolution is that divided by cos(latitude).
    const zoom = 10;
    const mercatorResolution = resolutionAtZoom(zoom) / Math.cos((16 * Math.PI) / 180);
    expect(scaleAtResolution(mercatorResolution)).toBeCloseTo(scaleAtZoom(zoom), 3);
  });
});

describe('the widened scale range', () => {
  it('spans a whole number of zoom levels, so OpenLayers honours both bounds', () => {
    // The bug this fixes: ol/View computes
    //   maxZoom = minZoom + floor(log2(maxResolution / minResolution))
    // so a fractional span is silently truncated. 1:7.500.000 -> 1:100.000 was
    // 6.23 levels, floored to 6, and the map stopped at 1:117.188 — 17% short
    // of the MAX_SCALE the constants advertised.
    const span = Math.log2(MIN_SCALE / MAX_SCALE);
    expect(span).toBe(Math.round(span));
    expect(MAX_ZOOM - MIN_ZOOM).toBeCloseTo(span, 9);
  });

  it('keeps a notch at 1:7.500.000, the previous far limit', () => {
    expect(ZOOM_SCALE_LEVELS).toContain(7_500_000);
  });

  it('still fits the whole of Vietnam at the far limit', () => {
    // MIN_SCALE moved out from 1:7.500.000 to 1:12.800.000, so this gets easier,
    // but it is the constraint that ruled out anchoring MIN_SCALE on 1:6.400.000.
    const heightPx = (1_725_000 / MIN_SCALE / 0.0254) * 96;
    expect(heightPx).toBeLessThanOrEqual(900);
  });
});
