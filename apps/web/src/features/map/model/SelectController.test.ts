import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Map from 'ol/Map';
import View from 'ol/View';
import Select from 'ol/interaction/Select';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type Layer from 'ol/layer/Layer';
import Feature, { type FeatureLike } from 'ol/Feature';
import RenderFeature from 'ol/render/Feature';
import Point from 'ol/geom/Point';
import type LineString from 'ol/geom/LineString';
import { fromLonLat } from 'ol/proj';
import { SelectController } from './SelectController';
import { createWaterTileLayer } from './waterTiles';
import { API_BASE_URL } from '../../../shared/config';

// jsdom lacks ResizeObserver (OL Map needs it).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

function makeMap(): { map: Map; damsLayer: VectorLayer<VectorSource>; riversLayer: Layer } {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  const damsLayer = new VectorLayer({ source: new VectorSource(), properties: { id: 'layer_dams' } });
  const riversLayer = createWaterTileLayer('rivers', 'layer_rivers', () => undefined);
  const map = new Map({ target: el, layers: [riversLayer, damsLayer], view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
  return { map, damsLayer, riversLayer };
}

function selectInteractions(map: Map): Select[] {
  return map.getInteractions().getArray().filter((i): i is Select => i instanceof Select);
}

describe('SelectController', () => {
  let map: Map; let damsLayer: VectorLayer<VectorSource>; let ctrl: SelectController;
  beforeEach(() => {
    ({ map, damsLayer } = makeMap());
    ctrl = new SelectController(map, { layer_dams: 'dams', layer_rivers: 'rivers' });
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

describe('SelectController on vector-tile water layers', () => {
  let map: Map; let damsLayer: VectorLayer<VectorSource>; let riversLayer: Layer; let ctrl: SelectController;
  // What a tile holds: clipped, simplified, in tile units. Never what the editor may edit.
  const tileFeature = new RenderFeature('LineString', [0, 0, 4096, 4096], [4], 2,
    { id: 'u1', layerKey: 'rivers', geographicalName: 'X', layer: 'rivers' }, undefined);
  const fetched = { type: 'LineString', coordinates: [[108, 13], [108.1, 13.1], [108.2, 13.3]] };

  /** Stands in for hit detection: yields `hits` top to bottom, honouring the caller's layer filter. */
  function hitsAtPixel(hits: Array<[FeatureLike, Layer]>) {
    const fake = (_px: unknown, cb: (f: FeatureLike, l: Layer) => unknown, opts?: { layerFilter?: (l: Layer) => boolean }) => {
      for (const [f, l] of hits) {
        if (opts?.layerFilter && !opts.layerFilter(l)) continue;
        const r = cb(f, l);
        if (r) return r;
      }
      return undefined;
    };
    return vi.spyOn(map, 'forEachFeatureAtPixel').mockImplementation(fake as never);
  }
  const click = () => map.dispatchEvent({ type: 'singleclick', pixel: [10, 10] } as never);
  const stubFetch = (impl: () => Promise<unknown>) => {
    const fetchMock = vi.fn((..._args: unknown[]) => impl());
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const ok = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body });

  beforeEach(() => {
    ({ map, damsLayer, riversLayer } = makeMap());
    ctrl = new SelectController(map, { layer_dams: 'dams', layer_rivers: 'rivers' });
  });
  afterEach(() => {
    ctrl.dispose();
    map.setTarget(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a click selects the tile feature by its id property, with the fetched (search endpoint) geometry, not the tile one', async () => {
    hitsAtPixel([[tileFeature, riversLayer]]);
    const fetchMock = stubFetch(ok({ name: 'X', geometry: fetched }));
    const onSelect = vi.fn();
    ctrl.activate(onSelect);
    click();
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/features/rivers/u1/geometry`);
    const sel = onSelect.mock.calls[0][0];
    expect(sel.featureId).toBe('u1');
    expect(sel.layerKey).toBe('rivers');
    expect(sel.geometry).toEqual(fetched);
    expect(sel.isoProps.geographicalName).toBe('X');
    expect(sel.isoProps).not.toHaveProperty('geometry');
    expect(sel.isoProps).not.toHaveProperty('layer');
    // The editor modifies this feature, so it carries the fetched geometry (map projection).
    const coords = (ctrl.getSelectedFeature()!.getGeometry() as LineString).getCoordinates();
    expect(coords).toHaveLength(3);
    expect(coords[2][0]).toBeCloseTo(fromLonLat([108.2, 13.3])[0], 3);
    expect(coords[2][1]).toBeCloseTo(fromLonLat([108.2, 13.3])[1], 3);
  });

  it('a click whose geometry fetch fails selects nothing and warns', async () => {
    hitsAtPixel([[tileFeature, riversLayer]]);
    const fetchMock = stubFetch(async () => { throw new Error('offline'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSelect = vi.fn();
    ctrl.activate(onSelect);
    click();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(ctrl.getSelectedFeature()).toBeNull();
  });

  it('a second click on the selected feature does not re-fetch (that would discard the edits)', async () => {
    hitsAtPixel([[tileFeature, riversLayer]]);
    const fetchMock = stubFetch(ok({ name: 'X', geometry: fetched }));
    const onSelect = vi.fn();
    ctrl.activate(onSelect);
    click();
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    click();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('leaves a WFS feature drawn above the river to the Select interaction', () => {
    const dam = new Feature({ geometry: new Point(fromLonLat([108, 13])) });
    hitsAtPixel([[dam, damsLayer as unknown as Layer], [tileFeature, riversLayer]]);
    const fetchMock = stubFetch(ok({ name: 'X', geometry: fetched }));
    ctrl.activate(() => {});
    click();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a late geometry response after edit mode ended selects nothing', async () => {
    hitsAtPixel([[tileFeature, riversLayer]]);
    let release: (v: unknown) => void = () => {};
    stubFetch(() => new Promise((r) => { release = r; }));
    const onSelect = vi.fn();
    ctrl.activate(onSelect);
    click();
    ctrl.deactivate();
    release({ ok: true, status: 200, json: async () => ({ name: 'X', geometry: fetched }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('deactivate stops listening for clicks', () => {
    const hit = hitsAtPixel([[tileFeature, riversLayer]]);
    stubFetch(ok({ name: 'X', geometry: fetched }));
    ctrl.activate(() => {});
    ctrl.deactivate();
    click();
    expect(hit).not.toHaveBeenCalled();
  });
});
