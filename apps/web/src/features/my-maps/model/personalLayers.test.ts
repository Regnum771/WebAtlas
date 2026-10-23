import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import Map from 'ol/Map';
import View from 'ol/View';
import type Layer from 'ol/layer/Layer';
import type VectorLayer from 'ol/layer/Vector';
import type VectorSource from 'ol/source/Vector';
import type { FeatureLike } from 'ol/Feature';
import type { StyleFunction } from 'ol/style/Style';
import { fromLonLat, get as getProjection, transformExtent } from 'ol/proj';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

const listFeatures = vi.fn();
vi.mock('../api/workspace.api', () => ({
  listFeatures: (...args: unknown[]) => listFeatures(...args),
}));

import type { LayerSummary, PersonalFeature } from '../api/workspace.api';
import { isPersonalLayer, PERSONAL_HIT_TOLERANCE } from '../../map/model/overlayLayers';
import {
  personalFeatureAt, refreshPersonalLayer, syncPersonalLayers, type PersonalLayerEntry,
} from './personalLayers';
import { CHANGED_OVERLAY } from './personalStyle';
import { getMyMaps, resetMyMapsStore, setTruncated } from './myMaps.store';
import { LayerRowView } from '../ui/LayerRow.view';

function makeMap(): Map {
  return new Map({ target: document.createElement('div'), view: new View({ center: fromLonLat([108, 16]), zoom: 8 }) });
}

const layer = (over: Partial<LayerSummary>): LayerSummary => ({
  id: 'l1', kind: 'free', title: 'Điểm khảo sát', position: 0, style: {}, geometryType: 'point', fields: [],
  layerKey: null, draftId: null, featureCount: 3, raster: null, ...over,
});
const FREE = layer({ id: 'l1' });
const COPY = layer({ id: 'l2', kind: 'edit_copy', title: 'Sửa lớp Hồ', geometryType: null, layerKey: 'lakes' });
const HIDDEN = layer({ id: 'l3', title: 'Ẩn' });
const RASTER = layer({ id: 'l4', kind: 'raster', title: 'Ảnh', geometryType: null });

const entry = (l: LayerSummary, over: Partial<PersonalLayerEntry> = {}): PersonalLayerEntry => ({
  mapId: 'm1', layer: l, visible: true, opacity: 1, zIndex: 800, onTruncated: vi.fn(), ...over,
});

const point = (id: string, lon: number, lat: number, properties: Record<string, unknown> = {}): PersonalFeature => ({
  type: 'Feature', id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties,
});
const fc = (features: PersonalFeature[], truncated: boolean, changed?: string[]) =>
  ({ type: 'FeatureCollection' as const, features, truncated, ...(changed ? { changed } : {}) });

const personalLayers = (map: Map) => map.getLayers().getArray().filter((l) => isPersonalLayer(l)) as VectorLayer<VectorSource>[];
const byId = (map: Map, id: string) => personalLayers(map).find((l) => l.get('id') === id)!;

const EPSG3857 = getProjection('EPSG:3857')!;
// Two views: a wide one around Đà Nẵng, then one zoomed in inside it.
const WIDE = transformExtent([107, 15, 109, 17], 'EPSG:4326', 'EPSG:3857');
const ZOOMED = transformExtent([108.1, 16, 108.3, 16.2], 'EPSG:4326', 'EPSG:3857');

beforeEach(() => {
  listFeatures.mockReset();
  resetMyMapsStore();
});

describe('syncPersonalLayers', () => {
  it('adds one layer per visible entry with id ws:<id> and personal: true; removes stale ones', () => {
    const map = makeMap();
    syncPersonalLayers(map, [
      entry(FREE, { zIndex: 802, opacity: 0.6 }),
      entry(COPY, { zIndex: 801 }),
      entry(HIDDEN, { visible: false }),
      entry(RASTER), // rasters are drawn by Task 6
    ]);
    expect(personalLayers(map).map((l) => l.get('id')).sort()).toEqual(['ws:l1', 'ws:l2']);
    for (const l of personalLayers(map)) {
      expect(l.get('personal')).toBe(true);
      expect(l.get('mapId')).toBe('m1');
    }
    const free = byId(map, 'ws:l1');
    expect(free.getZIndex()).toBe(802);
    expect(free.getOpacity()).toBe(0.6);
    expect(byId(map, 'ws:l2').getZIndex()).toBe(801);

    // A repeat sync keeps the same layer objects; a layer that left the list leaves the map.
    syncPersonalLayers(map, [entry(FREE, { zIndex: 805, opacity: 1 })]);
    expect(personalLayers(map).map((l) => l.get('id'))).toEqual(['ws:l1']);
    expect(byId(map, 'ws:l1')).toBe(free);
    expect(free.getZIndex()).toBe(805);
    expect(free.getOpacity()).toBe(1);

    syncPersonalLayers(map, []);
    expect(personalLayers(map)).toEqual([]);
    // Nothing left to read again after a move: the move listener goes with the last layer.
    expect(map.hasListener('moveend')).toBe(false);
  });

  it('a truncated read shows the note and every request carries a bbox', async () => {
    const map = makeMap();
    listFeatures
      .mockResolvedValueOnce(fc([point('a', 108, 16), point('b', 108.2, 16.1)], true))
      .mockResolvedValueOnce(fc([point('b', 108.2, 16.1), point('c', 108.21, 16.11)], false));
    const onTruncated = vi.fn(setTruncated);
    syncPersonalLayers(map, [entry(FREE, { onTruncated })]);
    const source = byId(map, 'ws:l1').getSource()!;

    source.loadFeatures(WIDE, 1000, EPSG3857);
    await vi.waitFor(() => expect(onTruncated).toHaveBeenCalledWith('l1', 2));
    const { unmount } = render(createElement(LayerRowView, {
      layer: { id: 'l1', title: FREE.title, kindLabel: 'Lớp vẽ', visible: true, opacity: 1, truncated: getMyMaps().truncated.l1 ?? null },
      onVisible: () => {}, onOpacity: () => {},
    }));
    expect(screen.getByText('Chỉ hiện 2 đối tượng đầu trong khung nhìn; phóng to để xem đủ.')).toBeInTheDocument();
    unmount();

    // A redraw of the same view does not ask again: that would loop, each read redrawing the layer.
    source.loadFeatures(WIDE, 1000, EPSG3857);
    expect(listFeatures).toHaveBeenCalledTimes(1);
    // Zooming in inside the cut view asks again once the move ends.
    map.dispatchEvent('moveend');
    source.loadFeatures(ZOOMED, 100, EPSG3857);
    await vi.waitFor(() => expect(onTruncated).toHaveBeenLastCalledWith('l1', null));
    expect(getMyMaps().truncated).toEqual({});

    expect(listFeatures).toHaveBeenCalledTimes(2);
    const [first, second] = listFeatures.mock.calls;
    for (const [mapId, layerId, query] of [first, second]) {
      expect([mapId, layerId]).toEqual(['m1', 'l1']);
      expect(query.limit).toBe(5000);
      expect(query.bbox).toHaveLength(4);
      const [w, s, e, n] = query.bbox as number[];
      expect(w).toBeGreaterThanOrEqual(-180); expect(e).toBeLessThanOrEqual(180);
      expect(s).toBeGreaterThanOrEqual(-90); expect(n).toBeLessThanOrEqual(90);
      expect(w).toBeLessThan(e); expect(s).toBeLessThan(n);
    }
    expect(first[2].bbox[0]).toBeCloseTo(107, 5);
    expect(first[2].bbox[3]).toBeCloseTo(17, 5);
    expect(second[2].bbox[0]).toBeCloseTo(108.1, 5);
    // The same feature read twice is kept once.
    expect(source.getFeatures().map((f) => f.getId()).sort()).toEqual(['a', 'b', 'c']);
  });

  it('draws the changed features of an edit copy with the overlay', async () => {
    const map = makeMap();
    listFeatures.mockResolvedValueOnce(fc([
      point('r1', 108, 16, { external_id: '3' }),
      point('r2', 108.1, 16.1, { external_id: '7' }),
    ], false, ['7']));
    syncPersonalLayers(map, [entry(COPY)]);
    const copy = byId(map, 'ws:l2');
    copy.getSource()!.loadFeatures(WIDE, 1000, EPSG3857);
    await vi.waitFor(() => expect(copy.getSource()!.getFeatures()).toHaveLength(2));
    const style = copy.getStyleFunction() as StyleFunction;
    const drawn = (id: string) => style(copy.getSource()!.getFeatureById(id) as FeatureLike, 1) as unknown[];
    expect(drawn('r1')).not.toContain(CHANGED_OVERLAY);
    expect(drawn('r2')).toContain(CHANGED_OVERLAY);
  });

  it('a failed read is retried once the view moves, not on every redraw', async () => {
    const map = makeMap();
    listFeatures.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(fc([point('a', 108, 16)], false));
    syncPersonalLayers(map, [entry(FREE)]);
    const source = byId(map, 'ws:l1').getSource()!;
    source.loadFeatures(WIDE, 1000, EPSG3857);
    await vi.waitFor(() => expect(listFeatures).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    source.loadFeatures(WIDE, 1000, EPSG3857);
    expect(listFeatures).toHaveBeenCalledTimes(1);
    map.dispatchEvent('moveend');
    source.loadFeatures(WIDE, 1000, EPSG3857);
    await vi.waitFor(() => expect(source.getFeatures()).toHaveLength(1));
    expect(listFeatures).toHaveBeenCalledTimes(2);
  });
});

describe('refreshPersonalLayer', () => {
  it('clears the source and reads the view again', async () => {
    const map = makeMap();
    listFeatures
      .mockResolvedValueOnce(fc([point('a', 108, 16)], false))
      .mockResolvedValueOnce(fc([point('a', 108, 16), point('new', 108.1, 16)], false));
    syncPersonalLayers(map, [entry(FREE)]);
    const source = byId(map, 'ws:l1').getSource()!;
    source.loadFeatures(WIDE, 1000, EPSG3857);
    await vi.waitFor(() => expect(source.getFeatures()).toHaveLength(1));

    refreshPersonalLayer(map, 'l1');
    expect(source.getFeatures()).toHaveLength(0);
    source.loadFeatures(WIDE, 1000, EPSG3857);
    await vi.waitFor(() => expect(source.getFeatures()).toHaveLength(2));
    expect(listFeatures).toHaveBeenCalledTimes(2);
  });

  it('a read started before the refresh does not put its old features back', async () => {
    const map = makeMap();
    let release: (v: unknown) => void = () => {};
    listFeatures
      .mockImplementationOnce(() => new Promise((r) => { release = r; }))
      .mockResolvedValueOnce(fc([point('fresh', 108, 16)], false));
    syncPersonalLayers(map, [entry(FREE)]);
    const source = byId(map, 'ws:l1').getSource()!;
    source.loadFeatures(WIDE, 1000, EPSG3857);
    refreshPersonalLayer(map, 'l1');
    source.loadFeatures(WIDE, 1000, EPSG3857);
    await vi.waitFor(() => expect(source.getFeatures()).toHaveLength(1));
    release(fc([point('stale', 108, 16)], false));
    await new Promise((r) => setTimeout(r, 0));
    expect(source.getFeatures().map((f) => f.getId())).toEqual(['fresh']);
  });
});

describe('personalFeatureAt', () => {
  it('returns the topmost personal feature as GeoJSON in EPSG:4326, with its map and layer', async () => {
    const map = makeMap();
    listFeatures.mockResolvedValueOnce(fc([point('a', 108.25, 16.05, { ten: 'Cống A', ghi_chu: null })], false));
    syncPersonalLayers(map, [entry(FREE)]);
    const free = byId(map, 'ws:l1');
    free.getSource()!.loadFeatures(WIDE, 1000, EPSG3857);
    await vi.waitFor(() => expect(free.getSource()!.getFeatures()).toHaveLength(1));
    const official = { get: (k: string) => (k === 'id' ? 'layer_dams' : undefined) } as unknown as Layer;
    // Stands in for hit detection (jsdom draws nothing): yields the hits top to bottom, honouring the filter.
    vi.spyOn(map, 'forEachFeatureAtPixel').mockImplementation(((_px: unknown, cb: (f: FeatureLike, l: Layer) => unknown, opts?: { layerFilter?: (l: Layer) => boolean }) => {
      const hits: Array<[FeatureLike, Layer]> = [
        [free.getSource()!.getFeatures()[0], official], // an official layer is never returned
        [free.getSource()!.getFeatures()[0], free as unknown as Layer],
      ];
      for (const [f, l] of hits) {
        if (opts?.layerFilter && !opts.layerFilter(l)) continue;
        const r = cb(f, l);
        if (r) return r;
      }
      return undefined;
    }) as never);

    const hit = personalFeatureAt(map, [10, 10])!;
    expect(hit.mapId).toBe('m1');
    expect(hit.layerId).toBe('l1');
    expect(hit.feature.id).toBe('a');
    expect(hit.feature.properties).toEqual({ ten: 'Cống A', ghi_chu: null });
    expect(hit.feature.geometry!.type).toBe('Point');
    const [lon, lat] = hit.feature.geometry!.coordinates as number[];
    expect(lon).toBeCloseTo(108.25, 6);
    expect(lat).toBeCloseTo(16.05, 6);
  });

  it('a click 2 px off a personal line hits it, with the tolerance the official popup also uses', async () => {
    const map = makeMap();
    listFeatures.mockResolvedValueOnce(fc([point('a', 108.25, 16.05)], false));
    syncPersonalLayers(map, [entry(FREE)]);
    const free = byId(map, 'ws:l1');
    free.getSource()!.loadFeatures(WIDE, 1000, EPSG3857);
    await vi.waitFor(() => expect(free.getSource()!.getFeatures()).toHaveLength(1));
    // The feature is 2 px from the click: only a hit test with a tolerance of 2 px or more finds it.
    const spy = vi.spyOn(map, 'forEachFeatureAtPixel').mockImplementation(((_px: unknown, cb: (f: FeatureLike, l: Layer) => unknown, opts?: { hitTolerance?: number }) =>
      ((opts?.hitTolerance ?? 0) >= 2 ? cb(free.getSource()!.getFeatures()[0], free as unknown as Layer) : undefined)) as never);
    expect(personalFeatureAt(map, [10, 10])?.feature.id).toBe('a');
    expect((spy.mock.calls[0][2] as { hitTolerance?: number }).hitTolerance).toBe(PERSONAL_HIT_TOLERANCE);
  });

  it('returns null when no personal feature is under the pixel', () => {
    const map = makeMap();
    vi.spyOn(map, 'forEachFeatureAtPixel').mockReturnValue(undefined);
    expect(personalFeatureAt(map, [1, 1])).toBeNull();
  });
});
