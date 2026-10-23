import { describe, it, expect } from 'vitest';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import { Circle as CircleStyle, Style } from 'ol/style';
import { lakesStyle } from '../../map/model/styles';
import { CHANGED_OVERLAY, DEFAULT_STYLE, editCopyStyle, olStyleFor, parseStyle } from './personalStyle';

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
