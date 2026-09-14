import { describe, it, expect } from 'vitest';
import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import { LAYER_PALETTE } from '@webatlas/shared';
import {
  riversStyle,
  makeDamsStyle,
  lakesStyle,
  provincesStyle,
  wardsStyle,
  stationsStyle,
  floodStyle,
  droughtSurveyStyle,
  saltwaterIntrusionStyle,
  floodGenerationStyle,
} from './styles';

// Minimal fake OL feature: only get() is used by the style functions.
function fakeFeature(props: Record<string, unknown>) {
  return { get: (k: string) => props[k], set: () => {} } as any;
}


/** Resolution ở mức phóng to nhất — LOD không ẩn bucket nào, nên các ca kiểm thử
 *  về màu/độ rộng bên dưới kiểm đúng thứ chúng định kiểm. */
const FULL_DETAIL_RESOLUTION = 1;

describe('style caching', () => {
  it('riversStyle returns the SAME array reference for the same stream order (cached)', () => {
    const f = fakeFeature({ streamOrder: 1 });
    const a = riversStyle(f, FULL_DETAIL_RESOLUTION);
    const b = riversStyle(fakeFeature({ streamOrder: 1 }), FULL_DETAIL_RESOLUTION);
    expect(a).toBe(b);
  });

  it('riversStyle returns styles (array of ol/style Style)', () => {
    const styles = riversStyle(fakeFeature({ streamOrder: 2 }), FULL_DETAIL_RESOLUTION);
    expect(Array.isArray(styles)).toBe(true);
    expect(styles![0]).toBeInstanceOf(Style);
  });

  it('makeDamsStyle colors by statusSlug from the shared map', () => {
    const damsStyle = makeDamsStyle(() => 'all');
    const style = damsStyle(fakeFeature({ statusSlug: 'nguy_hiem', ratedPower: 100 }));
    // single Style with a CircleStyle image whose fill is the nguy_hiem color
    const image = (style as Style).getImage() as CircleStyle;
    const fillColor = image?.getFill?.()?.getColor();
    expect(fillColor).toBe('#ef4444');
  });

  it('makeDamsStyle caches identical (slug,radius) styles', () => {
    const damsStyle = makeDamsStyle(() => 'all');
    const a = damsStyle(fakeFeature({ statusSlug: 'binh_thuong', ratedPower: 100 }));
    const b = damsStyle(fakeFeature({ statusSlug: 'binh_thuong', ratedPower: 100 }));
    expect(a).toBe(b);
  });

  it('makeDamsStyle hides a dam whose slug does not match the active filter', () => {
    const damsStyle = makeDamsStyle(() => 'nguy_hiem');
    const hidden = damsStyle(fakeFeature({ statusSlug: 'binh_thuong', ratedPower: 100 }));
    expect(hidden).toBeUndefined();
  });

  it('lakesStyle has a blue fill and a stroke', () => {
    expect(lakesStyle.getFill()).toBeInstanceOf(Fill);
    expect(lakesStyle.getStroke()).toBeInstanceOf(Stroke);
  });
});

// Guards against the map styles and the legend swatches (packages/shared/src/legend.ts)
// drifting apart again: both must read the same LAYER_PALETTE, so a hex color
// changed on only one side fails here.
describe('map styles stay on the shared LAYER_PALETTE (legend/map colour parity)', () => {
  function hexToRgbTuple(hex: string): [number, number, number] {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function colorOfFill(fill: Fill | null): string | undefined {
    const c = fill?.getColor();
    return typeof c === 'string' ? c : undefined;
  }

  it('stationsStyle fill matches LAYER_PALETTE.layer_stations', () => {
    const image = stationsStyle.getImage() as CircleStyle;
    expect(colorOfFill(image.getFill())).toBe(LAYER_PALETTE.layer_stations.color);
  });

  it('riversStyle core stroke matches LAYER_PALETTE.layer_rivers', () => {
    const styles = riversStyle(fakeFeature({ streamOrder: 5 }), FULL_DETAIL_RESOLUTION);
    const core = styles![styles!.length - 1].getStroke();
    expect(core?.getColor()).toBe(LAYER_PALETTE.layer_rivers.color);
  });

  it('lakesStyle stroke matches LAYER_PALETTE.layer_lakes.stroke, fill matches its hue', () => {
    expect(lakesStyle.getStroke()?.getColor()).toBe(LAYER_PALETTE.layer_lakes.stroke);
    const [r, g, b] = hexToRgbTuple(LAYER_PALETTE.layer_lakes.color);
    expect(colorOfFill(lakesStyle.getFill())).toBe(`rgba(${r}, ${g}, ${b}, 0.35)`);
  });

  it('floodStyle stroke matches LAYER_PALETTE.layer_flood', () => {
    expect(floodStyle.getStroke()?.getColor()).toBe(LAYER_PALETTE.layer_flood.color);
  });

  it('droughtSurveyStyle fill matches LAYER_PALETTE.layer_drought_survey', () => {
    const image = droughtSurveyStyle.getImage() as CircleStyle;
    expect(colorOfFill(image.getFill())).toBe(LAYER_PALETTE.layer_drought_survey.color);
  });

  it('saltwaterIntrusionStyle fill matches LAYER_PALETTE.layer_saltwater_intrusion', () => {
    const image = saltwaterIntrusionStyle.getImage() as CircleStyle;
    expect(colorOfFill(image.getFill())).toBe(LAYER_PALETTE.layer_saltwater_intrusion.color);
  });

  it('floodGenerationStyle stroke matches LAYER_PALETTE.layer_flood_generation', () => {
    expect(floodGenerationStyle.getStroke()?.getColor()).toBe(LAYER_PALETTE.layer_flood_generation.color);
  });

  it('provincesStyle boundary stroke matches LAYER_PALETTE.layer_provinces_2026', () => {
    const feature = { get: () => undefined, set: () => {}, getGeometry: () => undefined } as any;
    const styles = provincesStyle(feature) as Style[];
    expect(styles[0].getStroke()?.getColor()).toBe(LAYER_PALETTE.layer_provinces_2026.color);
  });

  it('rivers get wider as Strahler order increases', () => {
    const widthFor = (order: number) => {
      const styles = riversStyle(fakeFeature({ streamOrder: order }), FULL_DETAIL_RESOLUTION);
      // main (core) stroke is the last style in the paired array
      const stroke = styles![styles!.length - 1].getStroke();
      expect(stroke).toBeInstanceOf(Stroke);
      const width = stroke!.getWidth();
      expect(width).toBeDefined();
      return width!;
    };
    expect(widthFor(8)).toBeGreaterThan(widthFor(2));
  });
});

import { STREAM_ORDER_LABELS } from '@webatlas/shared';

describe('độ rộng nét sông theo hạng OSM', () => {
  const widthOf = (order: number): number => {
    const styles = riversStyle({ get: (k: string) => (k === 'streamOrder' ? order : undefined) } as any, FULL_DETAIL_RESOLUTION);
    // riversStyle luôn trả mảng cặp [viền, lõi] khi có vẽ; ở FULL_DETAIL_RESOLUTION
    // thì không bucket nào bị ẩn nên chắc chắn có giá trị.
    const stroke = styles![1].getStroke();
    return stroke?.getWidth() ?? 0;
  };

  it('sông chính vẽ đậm hơn kênh, kênh đậm hơn suối, suối đậm hơn mương', () => {
    expect(widthOf(5)).toBeGreaterThan(widthOf(4));
    expect(widthOf(4)).toBeGreaterThan(widthOf(2));
    expect(widthOf(2)).toBeGreaterThanOrEqual(widthOf(1));
  });

  it('mọi hạng OSM đều có nhãn hiển thị', () => {
    for (const order of [5, 4, 2, 1]) {
      expect(STREAM_ORDER_LABELS[order]).toBeTruthy();
    }
  });
});

// Ranh giới hành chính mới (sau sáp nhập) mang thuộc tính hoàn toàn khác GADM 4.1:
// code, name, nameEn, fullName, fullNameEn, codeName, gisServerId, areaKm2 — KHÔNG
// còn NAME_1/GID_1 (tỉnh) hay NAME_3/GID_3 (xã). Test này dùng đúng bộ thuộc tính
// thật để tránh tái diễn lỗi provincesStyle/wardsStyle đọc nhầm key GADM cũ.
describe('provincesStyle / wardsStyle dùng đúng thuộc tính ranh giới mới (không phải GADM)', () => {
  function fakeBoundaryFeature(props: Record<string, unknown>) {
    return {
      get: (k: string) => props[k],
      set: () => {},
      getGeometry: () => undefined,
    } as any;
  }

  it('provincesStyle hiển thị tên tỉnh từ thuộc tính "name" (không phải NAME_1)', () => {
    const feature = fakeBoundaryFeature({
      code: '48',
      name: 'Đắk Lắk',
      nameEn: 'Dak Lak',
      fullName: 'Tỉnh Đắk Lắk',
      fullNameEn: 'Dak Lak Province',
      codeName: 'dak_lak',
      gisServerId: 48,
      areaKm2: 13125.4,
    });
    const styles = provincesStyle(feature) as Style[];
    const labelStyle = styles[styles.length - 1];
    const text = labelStyle.getText() as Text;
    expect(text.getText()).toBe('Đắk Lắk');
  });

  it('wardsStyle hiển thị tên xã từ thuộc tính "name" (không phải NAME_3)', () => {
    const feature = fakeBoundaryFeature({
      code: '48012',
      name: 'Xã Ea Tul',
      nameEn: 'Ea Tul Commune',
      fullName: 'Xã Ea Tul',
      fullNameEn: 'Ea Tul Commune',
      codeName: 'ea_tul',
      gisServerId: 480123,
      areaKm2: 42.1,
    });
    const style = wardsStyle(feature) as Style;
    const text = style.getText() as Text;
    expect(text.getText()).toBe('Xã Ea Tul');
  });
});

import { minRiverBucketAt } from './styles';
import { resolutionAtZoom, zoomForScale, REFERENCE_LATITUDE } from './zoomScale';

/** The OL/3857 resolution that renders at a given scale denominator. */
function resolutionForScale(scale: number): number {
  return resolutionAtZoom(zoomForScale(scale)) / Math.cos((REFERENCE_LATITUDE * Math.PI) / 180);
}

describe('minRiverBucketAt', () => {
  it('draws only sông chính when most zoomed out', () => {
    expect(minRiverBucketAt(resolutionForScale(7_500_000))).toBe(3);
    expect(minRiverBucketAt(resolutionForScale(1_000_000))).toBe(3);
  });

  it('adds kênh đào from 1:500.000', () => {
    expect(minRiverBucketAt(resolutionForScale(999_999))).toBe(2);
    expect(minRiverBucketAt(resolutionForScale(500_000))).toBe(2);
  });

  it('adds suối from 1:250.000', () => {
    expect(minRiverBucketAt(resolutionForScale(499_999))).toBe(1);
    expect(minRiverBucketAt(resolutionForScale(250_000))).toBe(1);
  });

  it('hides nothing when most zoomed in', () => {
    expect(minRiverBucketAt(resolutionForScale(249_999))).toBe(0);
    expect(minRiverBucketAt(resolutionForScale(100_000))).toBe(0);
  });

  it('never hides sông chính at any scale — the coarsest tier is always drawn', () => {
    [7_500_000, 1_000_000, 500_000, 250_000, 100_000].forEach((scale) => {
      expect(minRiverBucketAt(resolutionForScale(scale))).toBeLessThanOrEqual(3);
    });
  });
});

describe('riversStyle level of detail', () => {
  const feature = (streamOrder: number) => ({ get: () => streamOrder }) as never;

  it('draws a main river when zoomed out', () => {
    expect(riversStyle(feature(5), resolutionForScale(7_500_000))).toBeDefined();
  });

  it('hides a ditch when zoomed out', () => {
    expect(riversStyle(feature(1), resolutionForScale(7_500_000))).toBeUndefined();
  });

  it('draws a ditch when fully zoomed in', () => {
    expect(riversStyle(feature(1), resolutionForScale(100_000))).toBeDefined();
  });
});
