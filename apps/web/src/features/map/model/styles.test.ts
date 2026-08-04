import { describe, it, expect } from 'vitest';
import { Style, Circle as CircleStyle, Fill, Stroke } from 'ol/style';
import { riversStyle, makeDamsStyle, lakesStyle } from './styles';

// Minimal fake OL feature: only get() is used by the style functions.
function fakeFeature(props: Record<string, unknown>) {
  return { get: (k: string) => props[k], set: () => {} } as any;
}

describe('style caching', () => {
  it('riversStyle returns the SAME array reference for the same stream order (cached)', () => {
    const f = fakeFeature({ streamOrder: 1 });
    const a = riversStyle(f);
    const b = riversStyle(fakeFeature({ streamOrder: 1 }));
    expect(a).toBe(b);
  });

  it('riversStyle returns styles (array of ol/style Style)', () => {
    const styles = riversStyle(fakeFeature({ streamOrder: 2 }));
    expect(Array.isArray(styles)).toBe(true);
    expect(styles[0]).toBeInstanceOf(Style);
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

  it('rivers get wider as Strahler order increases', () => {
    const widthFor = (order: number) => {
      const styles = riversStyle(fakeFeature({ streamOrder: order }));
      // main (core) stroke is the last style in the paired array
      const stroke = styles[styles.length - 1].getStroke();
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
    const styles = riversStyle({ get: (k: string) => (k === 'streamOrder' ? order : undefined) } as any);
    const stroke = (Array.isArray(styles) ? styles[1] : styles).getStroke();
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
