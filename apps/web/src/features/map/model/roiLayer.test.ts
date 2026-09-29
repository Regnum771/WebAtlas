import { describe, it, expect, vi } from 'vitest';
import Map from 'ol/Map';
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
import View from 'ol/View';
import { fromLonLat } from 'ol/proj';
import { ROI_LAYER_ID, drawRoi, eraseRoi, getRoiLayer } from './roiLayer';

function makeMap(): Map {
  const el = document.createElement('div');
  return new Map({ target: el, view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
}
const point = { type: 'Point' as const, coordinates: [108.05, 12.68] };

describe('roiLayer', () => {
  it('draws the ROI on its own layer and replaces it on the next call', () => {
    const map = makeMap();
    drawRoi(map, point, 'Đập A', false);
    drawRoi(map, point, 'Đập B', false);
    const layer = getRoiLayer(map)!;
    expect(layer.get('id')).toBe(ROI_LAYER_ID);
    const features = layer.getSource()!.getFeatures();
    expect(features).toHaveLength(1);
    expect(features[0].get('label')).toBe('Đập B');
  });

  it('fits only when asked', () => {
    const map = makeMap();
    const fit = vi.spyOn(map.getView(), 'fit');
    drawRoi(map, point, 'Đập A', false);
    expect(fit).not.toHaveBeenCalled();
    drawRoi(map, point, 'Đập A', true);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('erases, leaving the empty layer in place', () => {
    const map = makeMap();
    drawRoi(map, point, 'Đập A', false);
    eraseRoi(map);
    expect(getRoiLayer(map)!.getSource()!.getFeatures()).toHaveLength(0);
  });
});
