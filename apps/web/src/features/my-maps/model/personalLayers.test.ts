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

// The real OpenLayers classes, recording the options they were built with.
const built = vi.hoisted(() => ({ geotiff: [] as unknown[], tile: [] as unknown[] }));
vi.mock('ol/source/GeoTIFF', async (importOriginal) => {
  const { default: GeoTIFF } = await importOriginal<typeof import('ol/source/GeoTIFF')>();
  class Recorded extends GeoTIFF {
    constructor(options: ConstructorParameters<typeof GeoTIFF>[0]) {
      super(options);
      built.geotiff.push(options);
    }
  }
  return { default: Recorded };
});
vi.mock('ol/layer/WebGLTile', async (importOriginal) => {
  const { default: WebGLTile } = await importOriginal<typeof import('ol/layer/WebGLTile')>();
  class Recorded extends WebGLTile {
    constructor(options: ConstructorParameters<typeof WebGLTile>[0]) {
      super(options);
      built.tile.push(options);
    }
  }
  return { default: Recorded };
});

import WebGLTileLayer, { type Style as TileStyle } from 'ol/layer/WebGLTile';
import GeoTIFF, { type Options as GeoTIFFOptions } from 'ol/source/GeoTIFF';
import type { LayerSummary, PersonalFeature } from '../api/workspace.api';
import { setAuthToken } from '../../../shared/api/apiClient';
import { API_BASE_URL } from '../../../shared/config';
import { isPersonalLayer, PERSONAL_HIT_TOLERANCE } from '../../map/model/overlayLayers';
import {
  fitToExtent4326, personalFeatureAt, refreshPersonalLayer, syncPersonalLayers, type PersonalLayerEntry,
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
const rasterMeta = (over: Record<string, unknown>) => ({
  width: 100, height: 80, bands: 1, dtype: 'uint8', nodata: null, bounds4326: [108, 16, 108.1, 16.1],
  sourceCrs: 'EPSG:4326', ...over,
});
const raster = (id: string, meta: Record<string, unknown>) =>
  layer({ id, kind: 'raster', title: 'Ảnh', geometryType: null, featureCount: null, raster: rasterMeta(meta) });
// An RGB image without nodata: the worker gave it an alpha band (band 4).
const RGB = raster('l5', {
  bands: 3, stats: [{ min: 10, max: 200 }, { min: 5, max: 180 }, { min: 0, max: 250 }],
});

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

// A GeoTIFF source starts reading its URL at once: the request is recorded and never answered.
const fetchMock = vi.fn((..._args: unknown[]) => new Promise<Response>(() => {}));

beforeEach(() => {
  listFeatures.mockReset();
  resetMyMapsStore();
  built.geotiff.length = 0;
  built.tile.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  setAuthToken(null);
});

describe('syncPersonalLayers', () => {
  it('adds one layer per visible entry with id ws:<id> and personal: true; removes stale ones', () => {
    const map = makeMap();
    syncPersonalLayers(map, [
      entry(FREE, { zIndex: 802, opacity: 0.6 }),
      entry(COPY, { zIndex: 801 }),
      entry(HIDDEN, { visible: false }),
      entry(RASTER),
    ]);
    expect(personalLayers(map).map((l) => l.get('id')).sort()).toEqual(['ws:l1', 'ws:l2', 'ws:l4']);
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
      layer: { id: 'l1', kind: 'free', title: FREE.title, kindLabel: 'Lớp vẽ', visible: true, opacity: 1, truncated: getMyMaps().truncated.l1 ?? null },
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

describe('raster layers', () => {
  const lastGeoTIFF = () => built.geotiff[built.geotiff.length - 1] as GeoTIFFOptions;
  const lastStyle = () => (built.tile[built.tile.length - 1] as { style: TileStyle }).style;

  it("a raster entry builds a WebGLTile over the layer's raster URL with the bearer header", async () => {
    setAuthToken('tok-1');
    const map = makeMap();
    syncPersonalLayers(map, [entry(RGB, { zIndex: 803, opacity: 0.7 })]);
    const tile = personalLayers(map).find((l) => l.get('id') === 'ws:l5') as unknown as WebGLTileLayer;
    expect(tile).toBeInstanceOf(WebGLTileLayer);
    expect(tile.get('personal')).toBe(true);
    expect(tile.get('mapId')).toBe('m1');
    expect(tile.getZIndex()).toBe(803);
    expect(tile.getOpacity()).toBe(0.7);
    expect(tile.getSource()).toBeInstanceOf(GeoTIFF);

    const url = `${API_BASE_URL}/api/workspace/maps/m1/layers/l5/raster`;
    const options = lastGeoTIFF();
    expect(options.sources).toHaveLength(1);
    expect(options.sources[0].url).toBe(url);
    expect(options.sourceOptions?.headers).toEqual({ Authorization: 'Bearer tok-1' });
    expect(options.normalize).toBe(true);
    // The source really asks for the COG with the token.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [requested, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(requested)).toBe(url);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-1');
    // Bands 1-3 as red, green and blue; the alpha band the worker added masks.
    expect(lastStyle().color).toEqual(['array', ['band', 1], ['band', 2], ['band', 3], ['band', 4]]);

    // A repeat sync keeps the layer; hiding it takes it off the map.
    syncPersonalLayers(map, [entry(RGB, { zIndex: 801, opacity: 1 })]);
    expect(personalLayers(map).find((l) => l.get('id') === 'ws:l5')).toBe(tile);
    expect(tile.getZIndex()).toBe(801);
    expect(built.tile).toHaveLength(1);
    syncPersonalLayers(map, [entry(RGB, { visible: false })]);
    expect(personalLayers(map)).toEqual([]);
  });

  it("stats set the source's min and max; a one-band raster draws grey", () => {
    const map = makeMap();
    const grey = ['band', 1];
    // One uint8 band without nodata: the worker's alpha band is band 2, read as 0-255.
    syncPersonalLayers(map, [entry(raster('g1', { stats: [{ min: 3, max: 90 }] }))]);
    expect(lastGeoTIFF().sources[0]).toMatchObject({ min: [3, 0], max: [90, 255] });
    expect(lastGeoTIFF().sources[0].nodata).toBeUndefined();
    expect(lastStyle().color).toEqual(['array', grey, grey, grey, ['band', 2]]);

    // A float elevation model with nodata: no alpha band; the source adds one for nodata (band 2).
    syncPersonalLayers(map, [entry(raster('g2', { dtype: 'float32', nodata: -9999, stats: [{ min: 2.5, max: 1480 }] }))]);
    expect(lastGeoTIFF().sources[0]).toMatchObject({ min: [2.5], max: [1480], nodata: -9999 });
    expect(lastStyle().color).toEqual(['array', grey, grey, grey, ['band', 2]]);

    // NaN nodata arrives as the string "NaN".
    syncPersonalLayers(map, [entry(raster('g3', { dtype: 'float32', nodata: 'NaN', stats: [{ min: 0, max: 1 }] }))]);
    expect(Number.isNaN(lastGeoTIFF().sources[0].nodata)).toBe(true);
  });

  it('an RGBA source keeps its own alpha band; a uint16 alpha band counts as a mask', () => {
    const map = makeMap();
    syncPersonalLayers(map, [entry(raster('a1', {
      bands: 4, dtype: 'uint16', stats: [{ min: 1, max: 900 }, { min: 2, max: 800 }, { min: 3, max: 700 }],
    }))]);
    // Any alpha above 0 is opaque: read as 0-1, it is clamped to 1.
    expect(lastGeoTIFF().sources[0]).toMatchObject({ min: [1, 2, 3, 0], max: [900, 800, 700, 1] });
    expect(lastStyle().color).toEqual(['array', ['band', 1], ['band', 2], ['band', 3], ['band', 4]]);
  });

  it('without stats, a uint8 raster spans 0-255 and other types use no bounds', () => {
    const map = makeMap();
    // Imported before stats existed: no alpha band was added.
    syncPersonalLayers(map, [entry(raster('o1', { bands: 3 }))]);
    expect(lastGeoTIFF().sources[0]).toMatchObject({ min: 0, max: 255 });
    expect(lastStyle().color).toEqual(['array', ['band', 1], ['band', 2], ['band', 3], 1]);

    syncPersonalLayers(map, [entry(raster('o2', { dtype: 'int16', nodata: -32768 }))]);
    const source = lastGeoTIFF().sources[0];
    expect(source.min).toBeUndefined();
    expect(source.max).toBeUndefined();
    expect(source.nodata).toBe(-32768);
    expect(lastStyle().color).toEqual(['array', ['band', 1], ['band', 1], ['band', 1], ['band', 2]]);
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

describe('fitToExtent4326', () => {
  it('fits the view to an EPSG:4326 extent, capped at a street-level zoom', () => {
    const map = makeMap();
    const fit = vi.spyOn(map.getView(), 'fit').mockImplementation(() => {});
    fitToExtent4326(map, [107, 15, 108, 16]);
    expect(fit).toHaveBeenCalledTimes(1);
    const [extent, opts] = fit.mock.calls[0] as [number[], { maxZoom?: number }];
    const expected = transformExtent([107, 15, 108, 16], 'EPSG:4326', 'EPSG:3857');
    extent.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 3));
    expect(opts.maxZoom).toBeGreaterThan(0);
  });
});