import { describe, it, expect } from 'vitest';
import Map from 'ol/Map';
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
import View from 'ol/View';
import Draw from 'ol/interaction/Draw';
import { fromLonLat } from 'ol/proj';
import { startAnalysisDraw } from './analysisDraw';

function makeMap(): Map {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  return new Map({ target: el, view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
}

const draws = (map: Map) => map.getInteractions().getArray().filter((i) => i instanceof Draw);

describe('startAnalysisDraw', () => {
  it('adds one draw interaction and removes it on cleanup', () => {
    const map = makeMap();
    const layersBefore = map.getLayers().getLength();
    const stop = startAnalysisDraw(map, 'Polygon', () => {});
    expect(draws(map)).toHaveLength(1);
    expect(map.getLayers().getLength()).toBe(layersBefore + 1);
    stop();
    expect(draws(map)).toHaveLength(0);
    expect(map.getLayers().getLength()).toBe(layersBefore);
  });
});
