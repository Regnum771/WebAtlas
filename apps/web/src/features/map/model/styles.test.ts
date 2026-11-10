import { describe, it, expect } from 'vitest';
import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import { LAYER_PALETTE } from '@webatlas/shared';
import {
  riversStyle,
  makeDamsStyle,
  lakesStyle,
  provincesStyle,
  provinceLabelStyle,
  wardsStyle,
  wardLabelStyle,
  damMarkerScaleAt,
  stationsStyle,
  floodStyle,
  droughtSurveyStyle,
  saltwaterIntrusionStyle,
  floodGenerationStyle,
  officialStyleFor,
} from './styles';

// Minimal fake OL feature: only get() is used by the style functions.
function fakeFeature(props: Record<string, unknown>) {
  return { get: (k: string) => props[k], set: () => {} } as any;
}


/** The resolution at the closest zoom: the level of detail hides no bucket, so the colour
 *  and width tests below check what they mean to check. */
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

  it('province border lines are stroked in LAYER_PALETTE.layer_provinces_2026', () => {
    for (const kind of ['province', 'national']) {
      const border = provincesStyle(fakeFeature({ layer: 'province_borders', kind })) as Style;
      expect(border.getStroke()?.getColor()).toBe(LAYER_PALETTE.layer_provinces_2026.color);
    }
  });

  it('ward outlines are drawn in LAYER_PALETTE.layer_wards_2026', () => {
    const [r, g, b] = hexToRgbTuple(LAYER_PALETTE.layer_wards_2026.color);
    const outline = wardsStyle(fakeFeature({ layer: 'wards' })) as Style;
    expect(outline.getStroke()?.getColor()).toBe(`rgba(${r}, ${g}, ${b}, 0.75)`);
  });
});

import { STREAM_ORDER_LABELS } from '@webatlas/shared';

describe('OSM waterway ranks', () => {
  it('every rank has a display label', () => {
    for (const order of [5, 4, 2, 1]) {
      expect(STREAM_ORDER_LABELS[order]).toBeTruthy();
    }
  });
});

// The administrative boundaries after the merger carry properties unlike GADM 4.1's: code, name,
// nameEn, fullName, fullNameEn, areaKm2, and no NAME_1/GID_1 (province) or NAME_3/GID_3 (ward).
// These tests use the real property set so provincesStyle/wardsStyle cannot go back to reading
// the old GADM keys.
describe('provincesStyle / wardsStyle read the new boundary properties (not GADM)', () => {
  function fakeBoundaryFeature(props: Record<string, unknown>) {
    return {
      get: (k: string) => props[k],
      set: () => {},
      getGeometry: () => undefined,
    } as any;
  }

  it('a province polygon is filled (for hit-testing) but NOT stroked: only the border lines are', () => {
    // Stroking the polygons outlined the coast and ringed every island at sea.
    const polygon = provincesStyle(fakeBoundaryFeature({
      layer: 'provinces',
      code: '48',
      name: 'Đắk Lắk',
      nameEn: 'Dak Lak',
      fullName: 'Tỉnh Đắk Lắk',
      areaKm2: 13125.4,
    })) as Style;
    expect(polygon.getText()).toBeNull();
    expect(polygon.getStroke()).toBeNull();
    // The transparent fill stays: without it only the outline of a province is clickable.
    expect(polygon.getFill()).not.toBeNull();
  });

  it('the national land border is drawn heavier than a border between provinces', () => {
    const width = (kind: string) =>
      (provincesStyle(fakeBoundaryFeature({ layer: 'province_borders', kind })) as Style).getStroke()!.getWidth()!;
    expect(width('national')).toBeGreaterThan(width('province'));
  });

  it('province names come from the label layer style only, from the "name" property (not NAME_1)', () => {
    // The boundary layer draws no text: the names are drawn by a separate layer above all data.
    expect(provincesStyle(fakeBoundaryFeature({ layer: 'province_labels', code: '48', name: 'Đắk Lắk' }))).toBeUndefined();
    expect(provinceLabelStyle(fakeBoundaryFeature({ layer: 'provinces', code: '48', name: 'Đắk Lắk' }))).toBeUndefined();
    expect(provinceLabelStyle(fakeBoundaryFeature({ layer: 'province_borders', kind: 'province' }))).toBeUndefined();
    const label = provinceLabelStyle(fakeBoundaryFeature({ layer: 'province_labels', code: '48', name: 'Đắk Lắk' })) as Style;
    const text = label.getText() as Text;
    expect(text.getText()).toBe('Đắk Lắk');
    expect(text.getFont()).toBe('bold 12px Inter, system-ui, sans-serif');
    expect(label.getStroke()).toBeNull();
  });

  it('ward names come from the label layer style; the outline is a visible dash', () => {
    const label = fakeBoundaryFeature({ layer: 'ward_labels', code: '48012', name: 'Xã Ea Tul' });
    expect(wardsStyle(label)).toBeUndefined();
    expect((wardLabelStyle(label) as Style).getText()?.getText()).toBe('Xã Ea Tul');
    const polygon = fakeBoundaryFeature({ layer: 'wards', code: '48012', name: 'Xã Ea Tul', fullName: 'Xã Ea Tul' });
    expect(wardLabelStyle(polygon)).toBeUndefined();
    const outline = wardsStyle(polygon) as Style;
    expect(outline.getText()).toBeNull();
    expect(outline.getStroke()?.getLineDash()).toEqual([6, 3]);
    // The old 1 px dash at 40 % opacity read as a footpath on the OSM basemap.
    expect(outline.getStroke()!.getWidth()!).toBeGreaterThan(1);
  });
});

import { resolutionAtZoom, zoomForScale, REFERENCE_LATITUDE } from './zoomScale';

/** The OL/3857 resolution that renders at a given scale denominator. */
function resolutionForScale(scale: number): number {
  return resolutionAtZoom(zoomForScale(scale)) / Math.cos((REFERENCE_LATITUDE * Math.PI) / 180);
}

describe('dam markers by scale', () => {
  const radiusAt = (scale: number) => {
    const style = makeDamsStyle(() => 'all')(fakeFeature({ statusSlug: 'binh_thuong', ratedPower: 2000 }), resolutionForScale(scale));
    return ((style as Style).getImage() as CircleStyle).getRadius();
  };

  it('shrink when zoomed out, so far-zoom clusters stay separate dots', () => {
    expect(radiusAt(4_000_000)).toBeLessThan(radiusAt(1_500_000));
    expect(radiusAt(1_500_000)).toBeLessThan(radiusAt(100_000));
  });

  it('keep their full size when zoomed in, and never drop below 3 px', () => {
    expect(radiusAt(100_000)).toBe(17);
    expect(radiusAt(7_500_000)).toBeGreaterThanOrEqual(3);
    expect(damMarkerScaleAt(undefined)).toBe(1);
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

describe('officialStyleFor', () => {
  it('maps each editable layer to the style its official layer draws with', () => {
    expect(officialStyleFor('rivers')).toBe(riversStyle);
    expect(officialStyleFor('lakes')).toBe(lakesStyle);
    expect(officialStyleFor('stations')).toBe(stationsStyle);
    expect(officialStyleFor('flood_zones')).toBe(floodStyle);
    expect(officialStyleFor('drought_points')).toBe(droughtSurveyStyle);
    expect(officialStyleFor('saltwater_intrusion')).toBe(saltwaterIntrusionStyle);
    expect(officialStyleFor('flood_generation')).toBe(floodGenerationStyle);
    // Dams: the official cartodiagram with no status filter (the filter belongs to the official layer).
    const dams = officialStyleFor('dams') as (f: unknown) => Style | undefined;
    const style = dams(fakeFeature({ statusSlug: 'nguy_hiem', ratedPower: 100 }));
    expect(((style as Style).getImage() as CircleStyle).getFill()!.getColor()).toBe('#ef4444');
  });
});
