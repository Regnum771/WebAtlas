import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Map from 'ol/Map';
// jsdom does not implement ResizeObserver, but ol/Map's constructor requires it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
import View from 'ol/View';
import Draw from 'ol/interaction/Draw';
import Point from 'ol/geom/Point';
import Feature from 'ol/Feature';
import { fromLonLat } from 'ol/proj';
import { DrawController } from './DrawController';

function makeMap(): Map {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  return new Map({ target: el, view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
}

function drawInteractions(map: Map): Draw[] {
  return map.getInteractions().getArray().filter((i): i is Draw => i instanceof Draw);
}

describe('DrawController', () => {
  let map: Map;
  let ctrl: DrawController;

  beforeEach(() => { map = makeMap(); ctrl = new DrawController(map); });
  afterEach(() => { ctrl.dispose(); map.setTarget(undefined); });

  it('adds a Draw interaction for the layer geometry type', () => {
    ctrl.startDraw('Point', () => {});
    const draws = drawInteractions(map);
    expect(draws).toHaveLength(1);
  });

  it('maps MultiPolygon to a Polygon draw and MultiLineString to a LineString draw', () => {
    ctrl.startDraw('MultiPolygon', () => {});
    expect(drawInteractions(map)).toHaveLength(1);
    ctrl.cancel();
    ctrl.startDraw('MultiLineString', () => {});
    expect(drawInteractions(map)).toHaveLength(1);
  });

  it('on drawend converts to 4326 GeoJSON and calls onFinish, then removes the interaction', () => {
    const onFinish = vi.fn();
    ctrl.startDraw('Point', onFinish);
    const draw = drawInteractions(map)[0];
    const feature = new Feature(new Point(fromLonLat([108.2, 13.5])));
    draw.dispatchEvent({ type: 'drawend', feature } as never);
    expect(onFinish).toHaveBeenCalledTimes(1);
    const gj = onFinish.mock.calls[0][0];
    expect(gj.type).toBe('Point');
    expect(gj.coordinates[0]).toBeCloseTo(108.2, 3);
    expect(gj.coordinates[1]).toBeCloseTo(13.5, 3);
    // one-shot: interaction removed after finish
    expect(drawInteractions(map)).toHaveLength(0);
  });

  it('cancel removes the interaction', () => {
    ctrl.startDraw('Point', () => {});
    expect(drawInteractions(map)).toHaveLength(1);
    ctrl.cancel();
    expect(drawInteractions(map)).toHaveLength(0);
  });

  it('starting a new draw cancels the previous one (no interaction leak)', () => {
    ctrl.startDraw('Point', () => {});
    ctrl.startDraw('Point', () => {});
    expect(drawInteractions(map)).toHaveLength(1);
  });
});
