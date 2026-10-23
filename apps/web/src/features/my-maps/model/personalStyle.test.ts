import { describe, it, expect, vi, afterEach } from 'vitest';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import { Circle as CircleStyle, Style } from 'ol/style';
import { lakesStyle } from '../../map/model/styles';
import type { LayerSummary } from '../api/workspace.api';
import { CHANGED_OVERLAY, DEFAULT_STYLE, editCopyStyle, olStyleFor, parseStyle, symbolDataUrl } from './personalStyle';

const square = () => new Polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]);

describe('parseStyle', () => {
  it('falls back per key; rejects a non-hex colour', () => {
    expect(parseStyle({})).toEqual(DEFAULT_STYLE);
    expect(DEFAULT_STYLE).toEqual({ color: '#d9480f', width: 2, fillOpacity: 0.25, pointRadius: 6 });
    // Good keys are kept, bad ones fall back one by one, and unknown keys are dropped.
    expect(parseStyle({ color: '#1C7ED6', width: 4, fillOpacity: 'x', pointRadius: -1, dash: true })).toEqual({
      color: '#1C7ED6', width: 4, fillOpacity: 0.25, pointRadius: 6,
    });
    for (const color of ['red', '#abc', '#12345g', 'rgb(1,2,3)', 42, null]) {
      expect(parseStyle({ color }).color).toBe('#d9480f');
    }
    expect(parseStyle({ width: Number.NaN, fillOpacity: 1.5 })).toEqual(DEFAULT_STYLE);
    expect(parseStyle({ fillOpacity: 0 }).fillOpacity).toBe(0);
  });
});

describe('olStyleFor', () => {
  it('draws a free layer in its colour: stroke, translucent fill and point circle', () => {
    const style = olStyleFor({ color: '#1c7ed6', width: 3, fillOpacity: 0.5, pointRadius: 8 });
    expect(style.getStroke()!.getColor()).toBe('#1c7ed6');
    expect(style.getStroke()!.getWidth()).toBe(3);
    expect(style.getFill()!.getColor()).toBe('rgba(28, 126, 214, 0.5)');
    const circle = style.getImage() as CircleStyle;
    expect(circle.getRadius()).toBe(8);
    expect(circle.getFill()!.getColor()).toBe('#1c7ed6');
  });
});

describe('editCopyStyle', () => {
  it("an edit copy uses its official layer's style; a changed feature gets the dashed overlay on top", () => {
    const changed = new Set(['7']);
    const lakes = editCopyStyle('lakes', (id) => changed.has(id));
    const plain = new Feature({ geometry: square(), external_id: '3', name: 'Hồ A' });
    const edited = new Feature({ geometry: square(), external_id: '7', name: 'Hồ B' });
    expect(lakes(plain, 1)).toEqual([lakesStyle]);
    const both = lakes(edited, 1) as Style[];
    expect(both[0]).toBe(lakesStyle);
    expect(both[both.length - 1]).toBe(CHANGED_OVERLAY);

    // An edit copy's rows carry the database column names; the official style reads the
    // ISO names (status → statusSlug, wattage_mw → ratedPower), so a dam in danger is red.
    const dams = editCopyStyle('dams', () => false);
    const dam = new Feature({ geometry: new Point([0, 0]), external_id: '1', status: 'nguy_hiem', wattage_mw: 100 });
    const [damStyle] = dams(dam, 1) as Style[];
    expect(((damStyle.getImage() as CircleStyle).getFill()!.getColor())).toBe('#ef4444');

    const overlay = CHANGED_OVERLAY.getStroke()!;
    expect(overlay.getColor()).toBe('#7048e8');
    expect(overlay.getWidth()).toBe(3);
    expect(overlay.getLineDash()?.length).toBeGreaterThan(0);
  });
});

/**
 * jsdom has no 2D canvas: every canvas gets a context whose methods do nothing and whose
 * property writes are recorded, and toDataURL answers a numbered data URL.
 */
function stubCanvas() {
  const writes: { canvas: HTMLCanvasElement; key: string; value: unknown }[] = [];
  // OpenLayers tells a colour from a pattern or a gradient with instanceof.
  vi.stubGlobal('CanvasPattern', class {});
  vi.stubGlobal('CanvasGradient', class {});
  // A point symbol is a canvas OpenLayers later swaps for an ImageBitmap; it never resolves here.
  vi.stubGlobal('createImageBitmap', () => new Promise(() => {}));
  const contextOf = (canvas: HTMLCanvasElement) => {
    const stored: Record<string, unknown> = {};
    return new Proxy({}, {
      get: (_t, key) => (key === 'canvas' ? canvas : key in stored ? stored[key as string] : () => undefined),
      set: (_t, key, value) => {
        stored[key as string] = value;
        writes.push({ canvas, key: String(key), value });
        return true;
      },
    }) as unknown as RenderingContext;
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return contextOf(this);
  } as typeof HTMLCanvasElement.prototype.getContext);
  let n = 0;
  const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/png;base64,${++n}`);
  return { writes, toDataURL };
}

const summary = (over: Partial<LayerSummary>): LayerSummary => ({
  id: 'l1', kind: 'free', title: 'Lớp', position: 0, style: {}, geometryType: 'point', fields: [],
  layerKey: null, draftId: null, featureCount: 0, raster: null, ...over,
});

describe('symbolDataUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns a data URL and caches per layer and style', () => {
    const { writes, toDataURL } = stubCanvas();
    const free = summary({ id: 'sym-free', style: { color: '#1c7ed6' } });
    const area = symbolDataUrl(free, {}, 'polygon');
    expect(area).toMatch(/^data:image\/png/);
    // A free layer's area is drawn in its colour: the outline and the translucent fill.
    expect(writes).toContainEqual(expect.objectContaining({ key: 'strokeStyle', value: '#1c7ed6' }));
    expect(writes).toContainEqual(expect.objectContaining({ key: 'fillStyle', value: 'rgba(28, 126, 214, 0.25)' }));
    // A free layer's properties do not change its symbol: drawn once.
    expect(symbolDataUrl(free, { ten: 'khác' }, 'polygon')).toBe(area);
    expect(toDataURL).toHaveBeenCalledTimes(1);

    // Another geometry, another style, another layer: each drawn once more.
    const point = symbolDataUrl(free, {}, 'point');
    const recoloured = symbolDataUrl({ ...free, style: { color: '#000000' } }, {}, 'polygon');
    const other = symbolDataUrl({ ...free, id: 'sym-other' }, {}, 'polygon');
    expect(new Set([area, point, recoloured, other]).size).toBe(4);
    expect(toDataURL).toHaveBeenCalledTimes(4);

    // An edit copy of dams: the official symbol by status, read through the column-name step.
    const dams = summary({ id: 'sym-dams', kind: 'edit_copy', layerKey: 'dams', geometryType: null });
    const danger = symbolDataUrl(dams, { external_id: '1', status: 'nguy_hiem', wattage_mw: 100 }, 'point');
    expect(symbolDataUrl(dams, { external_id: '2', status: 'nguy_hiem', wattage_mw: 100 }, 'point')).toBe(danger);
    expect(toDataURL).toHaveBeenCalledTimes(5);
    const normal = symbolDataUrl(dams, { external_id: '3', status: 'binh_thuong', wattage_mw: 100 }, 'point');
    expect(normal).not.toBe(danger);
    expect(toDataURL).toHaveBeenCalledTimes(6);
  });
});