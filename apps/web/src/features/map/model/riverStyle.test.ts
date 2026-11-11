import { describe, it, expect } from 'vitest';
import { riversStyle, makeRiverSelectStyle, riverClassOf, minRiverClassAt, riverWidths } from './riverStyle';
import { resolutionAtZoom, zoomForScale, REFERENCE_LATITUDE } from './zoomScale';

const feature = (props: Record<string, unknown>) => ({ get: (k: string) => props[k] }) as never;

/** The OL/3857 resolution that renders at a given scale denominator. */
function resolutionForScale(scale: number): number {
  return resolutionAtZoom(zoomForScale(scale)) / Math.cos((REFERENCE_LATITUDE * Math.PI) / 180);
}
/** The 3857 resolution at a web-mercator zoom. */
const atZoom = (z: number) => 156543.03392804097 / 2 ** z;

describe('riverClassOf', () => {
  it('grades by the parent river Strahler order, not the OSM tag', () => {
    // OSM tags hill streams waterway=river too: rank 5 alone must not make a major river.
    expect(riverClassOf(feature({ streamOrder: 5, riverOrder: 6 }))).toBe(3);
    expect(riverClassOf(feature({ streamOrder: 5, riverOrder: 5 }))).toBe(3);
    expect(riverClassOf(feature({ streamOrder: 5, riverOrder: 4 }))).toBe(2);
    expect(riverClassOf(feature({ streamOrder: 5, riverOrder: 3 }))).toBe(1);
    expect(riverClassOf(feature({ streamOrder: 5, riverOrder: 1 }))).toBe(0);
  });

  it('caps a stream, a canal and a ditch by their OSM kind', () => {
    expect(riverClassOf(feature({ streamOrder: 2, riverOrder: 6 }))).toBe(1);
    expect(riverClassOf(feature({ streamOrder: 4, riverOrder: 6 }))).toBe(2);
    expect(riverClassOf(feature({ streamOrder: 1, riverOrder: 6 }))).toBe(0);
  });

  it('does not cap an overview river, which has a Strahler order and no OSM rank', () => {
    expect(riverClassOf(feature({ stream_order: 6, riverOrder: 6 }))).toBe(3);
  });

  it('without a Strahler order (a personal edit copy), never draws a major river', () => {
    expect(riverClassOf(feature({ streamOrder: 5 }))).toBe(2);
    expect(riverClassOf(feature({ streamOrder: 2 }))).toBe(1);
    expect(riverClassOf(feature({ streamOrder: 1 }))).toBe(0);
    expect(riverClassOf(feature({}))).toBe(2);
  });
});

describe('minRiverClassAt', () => {
  it('draws only major rivers when most zoomed out, everything when zoomed in', () => {
    expect(minRiverClassAt(resolutionForScale(7_500_000))).toBe(3);
    expect(minRiverClassAt(resolutionForScale(2_000_000))).toBe(3);
    expect(minRiverClassAt(resolutionForScale(1_999_999))).toBe(2);
    expect(minRiverClassAt(resolutionForScale(1_000_000))).toBe(2);
    expect(minRiverClassAt(resolutionForScale(999_999))).toBe(1);
    expect(minRiverClassAt(resolutionForScale(500_000))).toBe(1);
    expect(minRiverClassAt(resolutionForScale(499_999))).toBe(0);
    expect(minRiverClassAt(resolutionForScale(100_000))).toBe(0);
  });
});

describe('riverWidths', () => {
  it('grow with zoom, so a far-zoom river is not kilometres wide', () => {
    expect(riverWidths(3, atZoom(7)).core).toBeLessThan(riverWidths(3, atZoom(10)).core);
    expect(riverWidths(3, atZoom(10)).core).toBeLessThan(riverWidths(3, atZoom(13)).core);
    // Old style: a fixed 7 px casing at every scale.
    expect(riverWidths(3, atZoom(7)).casing).toBeLessThan(4);
  });

  it('grow with river size at every zoom', () => {
    for (const z of [7, 9, 11, 13, 15]) {
      const w = ([0, 1, 2, 3] as const).map((c) => riverWidths(c, atZoom(z)).core);
      expect(w[0]).toBeLessThan(w[1]);
      expect(w[1]).toBeLessThan(w[2]);
      expect(w[2]).toBeLessThan(w[3]);
    }
  });

  it('keep the casing wider than the core', () => {
    for (const z of [7, 10, 13]) {
      const { core, casing } = riverWidths(2, atZoom(z));
      expect(casing).toBeGreaterThan(core);
    }
  });
});

describe('riversStyle draw order', () => {
  it('puts every casing below every core (zIndex), so joins and confluences get no dark notch', () => {
    const big = riversStyle(feature({ streamOrder: 5, riverOrder: 6 }), atZoom(12))!;
    const small = riversStyle(feature({ streamOrder: 2, riverOrder: 2 }), atZoom(12))!;
    for (const [casing, core] of [big, small]) {
      expect(casing.getZIndex()).toBe(0);
      expect(core.getZIndex()).toBe(1);
    }
  });

  it('draws the clicked-river highlight above the whole network', () => {
    const [halo, core] = makeRiverSelectStyle()(feature({ streamOrder: 5, riverOrder: 6 }), atZoom(12));
    expect(halo.getZIndex()).toBe(2);
    expect(core.getZIndex()).toBe(3);
  });

  it('reuses one style array per width pair (no per-frame allocation)', () => {
    const a = riversStyle(feature({ streamOrder: 5, riverOrder: 6 }), atZoom(12));
    const b = riversStyle(feature({ streamOrder: 5, riverOrder: 5 }), atZoom(12));
    expect(a).toBe(b);
  });
});
