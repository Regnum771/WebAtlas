import { describe, it, expect } from 'vitest';
import Map from 'ol/Map';
import View from 'ol/View';
import { fromLonLat } from 'ol/proj';
import { viewExtent4326 } from './viewExtent';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

function mapAt(center: [number, number], zoom: number, size: [number, number] | undefined) {
  const map = new Map({ view: new View({ center: fromLonLat(center), zoom }) });
  if (size) map.setSize(size);
  return map;
}

describe('viewExtent4326', () => {
  it('is the view in lon/lat around its centre', () => {
    const box = viewExtent4326(mapAt([108, 15.5], 8, [800, 600]))!;
    expect(box).toHaveLength(4);
    expect(box[0]).toBeLessThan(108);
    expect(box[2]).toBeGreaterThan(108);
    expect(box[1]).toBeLessThan(15.5);
    expect(box[3]).toBeGreaterThan(15.5);
    expect(box[2] - box[0]).toBeLessThan(10);
  });

  it('is cut to the globe for a world-wrapped view', () => {
    const box = viewExtent4326(mapAt([0, 0], 0, [4000, 4000]))!;
    expect(box[0]).toBe(-180);
    expect(box[2]).toBe(180);
    expect(box[1]).toBeGreaterThanOrEqual(-90);
    expect(box[3]).toBeLessThanOrEqual(90);
  });

  it('is null without a map or before the map has a size', () => {
    expect(viewExtent4326(null)).toBeNull();
    expect(viewExtent4326(mapAt([108, 15.5], 8, undefined))).toBeNull();
  });
});
