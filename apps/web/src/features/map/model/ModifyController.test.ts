import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Map from 'ol/Map';
import View from 'ol/View';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { ModifyController } from './ModifyController';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}
function makeMap(): Map {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  return new Map({ target: el, view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
}
function interactionsOfType(map: Map, C: unknown): unknown[] {
  return map.getInteractions().getArray().filter((i) => i instanceof (C as never));
}

describe('ModifyController', () => {
  let map: Map; let ctrl: ModifyController;
  beforeEach(() => { map = makeMap(); ctrl = new ModifyController(map); });
  afterEach(() => { ctrl.dispose(); map.setTarget(undefined); });

  it('start adds Modify + Translate interactions', () => {
    const f = new Feature(new Point(fromLonLat([108, 13])));
    ctrl.start(f, () => {});
    expect(interactionsOfType(map, Modify)).toHaveLength(1);
    expect(interactionsOfType(map, Translate)).toHaveLength(1);
  });

  it('on translateend emits the moved geometry as 4326 GeoJSON', () => {
    const f = new Feature(new Point(fromLonLat([108, 13])));
    const onChange = vi.fn();
    ctrl.start(f, onChange);
    const translate = interactionsOfType(map, Translate)[0] as Translate;
    f.getGeometry()!.setCoordinates(fromLonLat([109.0, 14.0]));
    translate.dispatchEvent({ type: 'translateend', features: { getArray: () => [f] } } as never);
    expect(onChange).toHaveBeenCalledTimes(1);
    const gj = onChange.mock.calls[0][0];
    expect(gj.type).toBe('Point');
    expect(gj.coordinates[0]).toBeCloseTo(109.0, 2);
    expect(gj.coordinates[1]).toBeCloseTo(14.0, 2);
  });

  it('cancel removes both interactions', () => {
    ctrl.start(new Feature(new Point(fromLonLat([108, 13]))), () => {});
    ctrl.cancel();
    expect(interactionsOfType(map, Modify)).toHaveLength(0);
    expect(interactionsOfType(map, Translate)).toHaveLength(0);
  });

  it('starting again cancels the prior (no interaction leak)', () => {
    ctrl.start(new Feature(new Point(fromLonLat([108, 13]))), () => {});
    ctrl.start(new Feature(new Point(fromLonLat([108, 13]))), () => {});
    expect(interactionsOfType(map, Modify)).toHaveLength(1);
    expect(interactionsOfType(map, Translate)).toHaveLength(1);
  });
});
