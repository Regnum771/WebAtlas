import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Map from 'ol/Map';
import View from 'ol/View';
import type ImageLayer from 'ol/layer/Image';
import type ImageWMS from 'ol/source/ImageWMS';
import { fromLonLat } from 'ol/proj';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

vi.mock('../api/workspace.api', () => ({ listFeatures: vi.fn(() => new Promise(() => {})) }));

// The real catalogue layer code, with each call recorded: a link must draw through it.
const catalogueSync = vi.hoisted(() => vi.fn());
vi.mock('../../catalogue/model/catalogueLayers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../catalogue/model/catalogueLayers')>();
  return {
    ...real,
    syncCatalogueLayers: (...args: Parameters<typeof real.syncCatalogueLayers>) => {
      catalogueSync(...args);
      return real.syncCatalogueLayers(...args);
    },
  };
});

import { act, renderHook } from '@testing-library/react';
import { CATALOGUE_LAYER_PROP, syncCatalogueLayers } from '../../catalogue/model/catalogueLayers';
import { addCatalogueLayer, getCatalogue, resetCatalogue } from '../../catalogue/model/catalogue.store';
import { useCatalogueHover } from '../../catalogue/model/useCatalogueHover';
import type { CatalogueItem } from '../../catalogue/api/catalogue.api';
import { setAuthToken } from '../../../shared/api/apiClient';
import { isPersonalLayer } from '../../map/model/overlayLayers';
import type { LayerSummary } from '../api/workspace.api';
import { PERSONAL_CATALOGUE_PROP, syncPersonalLayers, type PersonalLayerEntry } from './personalLayers';

const item = (id: string, kind: CatalogueItem['kind'], timeSteps: string[] | null = null): CatalogueItem => ({
  id, kind, title: id, abstract: '', managingUnit: 'VN', isPublished: true, mine: false, variable: null, unit: null,
  timeSteps, bbox4326: null, layerName: `geonode:${id}`, updatedAt: '2026-11-12T00:00:00Z',
});
const link = (id: string, catalogue: CatalogueItem | null): LayerSummary => ({
  id, kind: 'catalogue', title: `Liên kết ${id}`, position: 0, style: {}, geometryType: null, fields: [],
  layerKey: null, draftId: null, featureCount: null, raster: null, catalogue,
});
const entry = (l: LayerSummary, over: Partial<PersonalLayerEntry> = {}): PersonalLayerEntry => ({
  mapId: 'm1', layer: l, visible: true, opacity: 1, zIndex: 805, onTruncated: vi.fn(), ...over,
});

const makeMap = () => new Map({ target: document.createElement('div'), view: new View({ center: fromLonLat([108, 16]), zoom: 8 }) });
const linkLayers = (map: Map) =>
  map.getLayers().getArray().filter((l) => typeof l.get(PERSONAL_CATALOGUE_PROP) === 'string') as ImageLayer<ImageWMS>[];
const freeLayers = (map: Map) =>
  map.getLayers().getArray().filter((l) => typeof l.get(CATALOGUE_LAYER_PROP) === 'string') as ImageLayer<ImageWMS>[];

beforeEach(() => {
  catalogueSync.mockClear();
  setAuthToken(null);
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});

describe('catalogue links in personal maps', () => {
  it('a link draws through syncCatalogueLayers: the catalogue WMS proxy, at the personal layer order', () => {
    const map = makeMap();
    syncPersonalLayers(map, [entry(link('c1', item('rain', 'vector')), { opacity: 0.7 })]);
    expect(catalogueSync).toHaveBeenCalled();
    const [, drawn, , scope] = catalogueSync.mock.calls.at(-1)!;
    expect(drawn).toEqual([expect.objectContaining({ key: 'c1', zIndex: 805, item: expect.objectContaining({ id: 'rain' }) })]);
    expect(scope.prop).toBe(PERSONAL_CATALOGUE_PROP);

    const [l] = linkLayers(map);
    expect(l.get(PERSONAL_CATALOGUE_PROP)).toBe('c1');
    expect(l.getSource()?.getUrl()).toMatch(/\/api\/catalogue\/rain\/wms$/);
    expect(l.getSource()?.getParams().LAYERS).toBe('geonode:rain');
    expect(l.getZIndex()).toBe(805);
    expect(l.getOpacity()).toBe(0.7);
    // A personal layer: never the official popup's or edit selection's target.
    expect(isPersonalLayer(l)).toBe(true);
    expect(l.get('mapId')).toBe('m1');
    // No free-standing catalogue layer was made for it.
    expect(freeLayers(map)).toHaveLength(0);
  });

  it('a time-series link follows the slider time with its own step, and hides before its first', () => {
    const map = makeMap();
    const series = link('c1', item('depth', 'timeseries', ['2025-10-25T00:00:00Z', '2025-10-25T01:00:00Z']));
    syncPersonalLayers(map, [entry(series)], '2025-10-25T00:30:00Z');
    const [l] = linkLayers(map);
    expect(l.getSource()?.getParams().TIME).toBe('2025-10-25T00:00:00Z');
    expect(l.getVisible()).toBe(true);
    syncPersonalLayers(map, [entry(series)], '2025-10-25T05:00:00Z');
    expect(linkLayers(map)[0]).toBe(l);
    expect(l.getSource()?.getParams().TIME).toBe('2025-10-25T01:00:00Z');
    syncPersonalLayers(map, [entry(series)], '2025-10-24T00:00:00Z');
    expect(l.getVisible()).toBe(false);
  });

  it('a link the reader cannot see (catalogue: null) or a hidden one draws nothing', () => {
    const map = makeMap();
    syncPersonalLayers(map, [entry(link('c1', null)), entry(link('c2', item('a', 'raster')), { visible: false })]);
    expect(linkLayers(map)).toHaveLength(0);
    syncPersonalLayers(map, [entry(link('c2', item('a', 'raster')))]);
    expect(linkLayers(map)).toHaveLength(1);
    syncPersonalLayers(map, []);
    expect(linkLayers(map)).toHaveLength(0);
  });

  it('the same entry as a free-standing layer and as a link: neither sync removes the other', () => {
    const map = makeMap();
    const rain = item('rain', 'vector');
    syncCatalogueLayers(map, [{ item: rain, visible: true, opacity: 1, status: 'ok' }], null);
    syncPersonalLayers(map, [entry(link('c1', rain)), entry(link('c2', rain), { zIndex: 804 })]);
    expect(freeLayers(map)).toHaveLength(1);
    // One entry linked twice draws twice: links are keyed by their layer id.
    expect(linkLayers(map).map((l) => l.get(PERSONAL_CATALOGUE_PROP)).sort()).toEqual(['c1', 'c2']);

    syncCatalogueLayers(map, [], null);
    expect(freeLayers(map)).toHaveLength(0);
    expect(linkLayers(map)).toHaveLength(2);
    syncCatalogueLayers(map, [{ item: rain, visible: true, opacity: 1, status: 'ok' }], null);
    syncPersonalLayers(map, []);
    expect(linkLayers(map)).toHaveLength(0);
    expect(freeLayers(map)).toHaveLength(1);
  });

  describe('hover values (useCatalogueHover, both scopes)', () => {
    const fetchMock = vi.fn();
    const series = (id: string, unit: string) => ({ ...item(id, 'timeseries', ['2025-10-26T00:00:00Z']), unit });
    const bareMap = () => new Map({ view: new View({ center: [0, 0], zoom: 5 }) });
    const move = (map: Map) => map.dispatchEvent({ type: 'pointermove', coordinate: [100, 100], pixel: [5, 5], dragging: false } as never);
    const tip = (map: Map) => map.getOverlays().getArray()[0].getElement() as HTMLElement;
    const show = async (map: Map) => { move(map); await vi.advanceTimersByTimeAsync(300); await vi.advanceTimersByTimeAsync(0); };

    beforeEach(() => {
      vi.useFakeTimers();
      resetCatalogue();
      fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ features: [{ properties: { GRAY_INDEX: 0.3049 } }] }) });
      vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('a time-series link in a personal map gets the hover value, through its own entry\'s proxy', async () => {
      const map = bareMap();
      syncPersonalLayers(map, [entry(link('c1', series('depth', 'm')))], '2025-10-26T05:00:00Z');
      renderHook(() => useCatalogueHover(map));
      await show(map);
      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toMatch(/\/api\/catalogue\/depth\/wms\?/);
      expect(url).toContain('GetFeatureInfo');
      expect(url).toContain('TIME=2025-10-26T00%3A00%3A00Z');
      expect(tip(map).hidden).toBe(false);
      expect(tip(map).textContent).toMatch(/^0,30 m · 26\/10\/2025/);
    });

    it('the topmost of a link and a free-standing series answers; hiding the link hides the label', async () => {
      const map = bareMap();
      addCatalogueLayer(series('rain', 'mm'));
      syncCatalogueLayers(map, getCatalogue(), '2025-10-26T05:00:00Z');
      const depth = link('c1', series('depth', 'm'));
      syncPersonalLayers(map, [entry(depth)], '2025-10-26T05:00:00Z');
      renderHook(() => useCatalogueHover(map));
      await show(map);
      // The personal link draws at 805, above the free-standing layers (700+).
      expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/catalogue\/depth\/wms\?/);
      expect(tip(map).textContent).toMatch(/ m · /);

      act(() => syncPersonalLayers(map, [entry(depth, { visible: false })], '2025-10-26T05:00:00Z'));
      expect(tip(map).hidden).toBe(true);
      await show(map);
      expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/catalogue\/rain\/wms\?/);
      expect(tip(map).textContent).toMatch(/ mm · /);
    });
  });

  it('a link image answering 403/404 tells the map to be read again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob() })));
    const map = makeMap();
    const onCatalogueGone = vi.fn();
    syncPersonalLayers(map, [entry(link('c1', item('rain', 'vector')), { onCatalogueGone })]);
    const source = linkLayers(map)[0].getSource()!;
    const img = document.createElement('img');
    source.getImageLoadFunction()({ getImage: () => img } as never, 'http://x/wms?A=1');
    await new Promise((r) => setTimeout(r, 0));
    expect(onCatalogueGone).toHaveBeenCalledWith('m1');
  });
});
