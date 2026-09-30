import { describe, it, expect, vi } from 'vitest';
import Map from 'ol/Map';
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
import View from 'ol/View';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import Draw, { DrawEvent } from 'ol/interaction/Draw';
import { fromLonLat } from 'ol/proj';
import { startRoiDraw } from './roiDraw';

function makeMap(): Map {
  const el = document.createElement('div');
  return new Map({ target: el, view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
}
const draws = (map: Map) => map.getInteractions().getArray().filter((i): i is Draw => i instanceof Draw);
const square = () => new Polygon([[fromLonLat([108, 13]), fromLonLat([108.1, 13]), fromLonLat([108.1, 13.1]), fromLonLat([108, 13])]]);

describe('startRoiDraw', () => {
  it('adds one draw interaction and a sketch layer, and removes both on cleanup', () => {
    const map = makeMap();
    const layersBefore = map.getLayers().getLength();
    const stop = startRoiDraw(map, 'Polygon', () => {});
    expect(draws(map)).toHaveLength(1);
    expect(map.getLayers().getLength()).toBe(layersBefore + 1);
    stop();
    expect(draws(map)).toHaveLength(0);
    expect(map.getLayers().getLength()).toBe(layersBefore);
  });

  it('draws a rectangle as a Polygon (OpenLayers draws boxes via Circle + createBox)', () => {
    const map = makeMap();
    const onDone = vi.fn();
    startRoiDraw(map, 'Box', onDone);
    draws(map)[0].dispatchEvent(new DrawEvent('drawend', new Feature(square())));
    expect(onDone.mock.calls[0][0].type).toBe('Polygon');
  });

  it('hands a finished shape over in EPSG:4326', () => {
    const map = makeMap();
    const onDone = vi.fn();
    startRoiDraw(map, 'Polygon', onDone);
    draws(map)[0].dispatchEvent(new DrawEvent('drawend', new Feature(square())));
    const [lon, lat] = onDone.mock.calls[0][0].coordinates[0][0];
    expect(lon).toBeCloseTo(108, 5);
    expect(lat).toBeCloseTo(13, 5);
  });

  it('refuses a shape the validator rejects, and says why', () => {
    const map = makeMap();
    const onDone = vi.fn(); const onInvalid = vi.fn();
    startRoiDraw(map, 'Polygon', onDone, { validate: () => 'Vùng tự cắt nhau — hãy vẽ lại', onInvalid });
    draws(map)[0].dispatchEvent(new DrawEvent('drawend', new Feature(square())));
    expect(onDone).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('Vùng tự cắt nhau — hãy vẽ lại');
  });

  it('lets the aids attach to the draw interaction and detaches them on cleanup', () => {
    const map = makeMap();
    const detach = vi.fn();
    const onDrawCreated = vi.fn(() => detach);
    const stop = startRoiDraw(map, 'LineString', () => {}, { onDrawCreated });
    expect(onDrawCreated).toHaveBeenCalledWith(draws(map)[0]);
    stop();
    expect(detach).toHaveBeenCalled();
  });
});
