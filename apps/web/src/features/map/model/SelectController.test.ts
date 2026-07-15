import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Map from 'ol/Map';
import View from 'ol/View';
import Select from 'ol/interaction/Select';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { SelectController } from './SelectController';

// jsdom lacks ResizeObserver (OL Map needs it).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

function makeMap(): { map: Map; damsLayer: VectorLayer<VectorSource> } {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  const damsLayer = new VectorLayer({ source: new VectorSource(), properties: { id: 'layer_dams' } });
  const map = new Map({ target: el, layers: [damsLayer], view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
  return { map, damsLayer };
}

function selectInteractions(map: Map): Select[] {
  return map.getInteractions().getArray().filter((i): i is Select => i instanceof Select);
}

describe('SelectController', () => {
  let map: Map; let damsLayer: VectorLayer<VectorSource>; let ctrl: SelectController;
  beforeEach(() => {
    ({ map, damsLayer } = makeMap());
    ctrl = new SelectController(map, { layer_dams: 'dams' });
  });
  afterEach(() => { ctrl.dispose(); map.setTarget(undefined); });

  it('activate adds a Select interaction; deactivate removes it', () => {
    ctrl.activate(() => {});
    expect(selectInteractions(map)).toHaveLength(1);
    ctrl.deactivate();
    expect(selectInteractions(map)).toHaveLength(0);
  });

  it('on select emits a plain EditSelection (layerKey, featureId, 4326 geometry, isoProps)', () => {
    const onSelect = vi.fn();
    ctrl.activate(onSelect);
    const feature = new Feature({ geometry: new Point(fromLonLat([108.2, 13.5])), geographicalName: 'Dam A' });
    feature.setId('dams.abc-123');
    damsLayer.getSource()!.addFeature(feature);
    // Drive the Select interaction's select event directly.
    const select = selectInteractions(map)[0];
    select.getFeatures().push(feature);
    select.dispatchEvent({ type: 'select', selected: [feature], deselected: [] } as never);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const sel = onSelect.mock.calls[0][0];
    expect(sel.layerKey).toBe('dams');
    expect(sel.featureId).toBe('abc-123'); // typename prefix stripped
    expect(sel.geometry.type).toBe('Point');
    expect(sel.geometry.coordinates[0]).toBeCloseTo(108.2, 3);
    expect(sel.isoProps.geographicalName).toBe('Dam A');
    expect(ctrl.getSelectedFeature()).toBe(feature);
  });

  it('clear resets the selected feature', () => {
    const onSelect = vi.fn();
    ctrl.activate(onSelect);
    const feature = new Feature({ geometry: new Point(fromLonLat([108, 13])) });
    feature.setId('dams.x');
    const select = selectInteractions(map)[0];
    select.dispatchEvent({ type: 'select', selected: [feature], deselected: [] } as never);
    ctrl.clear();
    expect(ctrl.getSelectedFeature()).toBeNull();
  });
});
