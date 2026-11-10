import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setAuthToken } from '../../../shared/api/apiClient';
import { fetchCatalogueLegend } from '../api/catalogue.api';
import { addCatalogueLayer, getCatalogue, resetCatalogue } from './catalogue.store';
import Map from 'ol/Map';
import type ImageLayer from 'ol/layer/Image';
import type ImageWMS from 'ol/source/ImageWMS';
import { CATALOGUE_Z_BASE, syncCatalogueLayers } from './catalogueLayers';
import type { CatalogueLayer } from './catalogue.store';
import type { CatalogueItem } from '../api/catalogue.api';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

const layer = (id: string, kind: CatalogueItem['kind'], over: Partial<CatalogueLayer> = {}): CatalogueLayer => ({
  item: {
    id, kind, title: id, abstract: '', managingUnit: null, isPublished: true, mine: false, variable: null, unit: null,
    timeSteps: kind === 'timeseries' ? ['2026-01-01T00:00:00Z'] : null, bbox4326: null, layerName: `geonode:${id}`,
  },
  visible: true, opacity: 1, status: 'ok', ...over,
});

const catLayers = (map: Map) => map.getLayers().getArray().filter((l) => l.get('catalogueId')) as ImageLayer<ImageWMS>[];

describe('syncCatalogueLayers', () => {
  it('draws one image layer per catalogue layer below the personal layers', () => {
    const map = new Map({});
    syncCatalogueLayers(map, [layer('a', 'vector'), layer('b', 'raster')], null);
    const ls = catLayers(map);
    expect(ls.map((l) => l.get('catalogueId'))).toEqual(['a', 'b']);
    expect(ls.map((l) => l.getZIndex())).toEqual([CATALOGUE_Z_BASE, CATALOGUE_Z_BASE + 1]);
    expect(CATALOGUE_Z_BASE).toBe(700);
    expect(ls[0].getSource()?.getUrl()).toMatch(/\/api\/catalogue\/a\/wms$/);
  });

  it('sets TIME only on time-series layers and updates it without recreating the layer', () => {
    const map = new Map({});
    syncCatalogueLayers(map, [layer('v', 'vector'), layer('t', 'timeseries')], '2026-01-01T00:00:00Z');
    const [v, t] = catLayers(map);
    expect(v.getSource()?.getParams().TIME).toBeUndefined();
    expect(t.getSource()?.getParams().TIME).toBe('2026-01-01T00:00:00Z');
    syncCatalogueLayers(map, [layer('v', 'vector'), layer('t', 'timeseries')], '2026-01-02T00:00:00Z');
    const [v2, t2] = catLayers(map);
    expect(t2).toBe(t);
    expect(v2).toBe(v);
    // The layer's own latest step at or before the slider time.
    expect(t2.getSource()?.getParams().TIME).toBe('2026-01-01T00:00:00Z');
    syncCatalogueLayers(map, [layer('t', 'timeseries')], null);
    expect(catLayers(map)[0].getSource()?.getParams().TIME).toBeUndefined();
  });

  it('each time-series layer asks for its own step at or before the slider time', () => {
    const map = new Map({});
    const withSteps = (id: string, steps: string[]) => {
      const l = layer(id, 'timeseries');
      l.item.timeSteps = steps;
      return l;
    };
    const rain = withSteps('rain', ['2025-10-25T00:00:00Z', '2025-10-26T00:00:00Z']);
    const depth = withSteps('depth', ['2025-10-25T00:00:00Z', '2025-10-25T01:00:00Z']);
    syncCatalogueLayers(map, [rain, depth], '2025-10-26T13:00:00Z');
    const [r, d] = catLayers(map);
    expect(r.getSource()?.getParams().TIME).toBe('2025-10-26T00:00:00Z');
    expect(d.getSource()?.getParams().TIME).toBe('2025-10-25T01:00:00Z');
  });

  it('hides a layer before its first step, not showing its first frame', () => {
    const map = new Map({});
    const depth = layer('depth', 'timeseries');
    depth.item.timeSteps = ['2025-10-25T00:00:00Z'];
    syncCatalogueLayers(map, [depth], '2025-10-24T12:00:00Z');
    expect(catLayers(map)[0].getVisible()).toBe(false);
    syncCatalogueLayers(map, [depth], '2025-10-25T06:00:00Z');
    expect(catLayers(map)[0].getVisible()).toBe(true);
  });

  it('applies visibility and opacity, and removes removed or gone layers', () => {
    const map = new Map({});
    syncCatalogueLayers(map, [layer('a', 'vector'), layer('b', 'vector')], null);
    syncCatalogueLayers(map, [layer('a', 'vector', { visible: false, opacity: 0.5 }), layer('b', 'vector', { status: 'gone' })], null);
    const ls = catLayers(map);
    expect(ls).toHaveLength(1);
    expect(ls[0].getVisible()).toBe(false);
    expect(ls[0].getOpacity()).toBe(0.5);
    syncCatalogueLayers(map, [], null);
    expect(catLayers(map)).toHaveLength(0);
  });
});

describe('image loading through fetch', () => {
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();
  const fetchMock = vi.fn();
  let blobN = 0;

  beforeEach(() => {
    blobN = 0;
    createObjectURL.mockReset().mockImplementation(() => `blob:${++blobN}`);
    revokeObjectURL.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    resetCatalogue();
    setAuthToken(null);
  });
  afterEach(() => { vi.unstubAllGlobals(); setAuthToken(null); });

  const ok = () => ({ ok: true, status: 200, blob: async () => new Blob(['x']) });
  const setup = (id = 'a') => {
    const item = layer(id, 'vector');
    addCatalogueLayer(item.item);
    const map = new Map({});
    syncCatalogueLayers(map, getCatalogue(), null);
    const source = catLayers(map)[0].getSource() as ImageWMS;
    const img = document.createElement('img');
    const load = (src = 'http://x/wms?A=1') => source.getImageLoadFunction()({ getImage: () => img } as never, src);
    return { map, img, load };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('sends the Bearer token when signed in and none when anonymous', async () => {
    fetchMock.mockResolvedValue(ok());
    const { load } = setup();
    setAuthToken('tok');
    load();
    await flush();
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer tok' });
    setAuthToken(null);
    load();
    await flush();
    expect(fetchMock.mock.calls[1][1].headers).toEqual({});
  });

  it('sets the blob URL as src and revokes it on load and on error', async () => {
    fetchMock.mockResolvedValue(ok());
    const { img, load } = setup();
    load();
    await flush();
    expect(img.getAttribute('src')).toBe('blob:1');
    img.dispatchEvent(new Event('load'));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:1');
    load();
    await flush();
    img.dispatchEvent(new Event('error'));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:2');
  });

  it('a fetch rejection dispatches the image error', async () => {
    fetchMock.mockRejectedValue(new TypeError('down'));
    const { img, load } = setup();
    const onError = vi.fn();
    img.addEventListener('error', onError);
    load();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(getCatalogue()[0].status).toBe('ok');
  });

  it('a superseded request is aborted and never sets src', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let firstSignal!: AbortSignal;
    fetchMock.mockImplementationOnce(async (_u: string, init: { signal: AbortSignal }) => {
      firstSignal = init.signal;
      await gate;
      return ok();
    });
    fetchMock.mockResolvedValueOnce(ok());
    const { img, load } = setup();
    load('http://x/wms?old=1');
    load('http://x/wms?new=1');
    release();
    await flush();
    expect(firstSignal.aborted).toBe(true);
    expect(img.getAttribute('src')).toBe('blob:1');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('removing the layer aborts its request', async () => {
    let signal!: AbortSignal;
    fetchMock.mockImplementation((_u: string, init: { signal: AbortSignal }) => { signal = init.signal; return new Promise(() => {}); });
    const { map, load } = setup();
    load();
    syncCatalogueLayers(map, [], null);
    expect(signal.aborted).toBe(true);
  });

  it('a 404 or 403 marks the layer gone and the next sync stops drawing it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, blob: async () => new Blob() });
    const { map, load } = setup();
    load();
    await flush();
    expect(getCatalogue()[0].status).toBe('gone');
    syncCatalogueLayers(map, getCatalogue(), null);
    expect(catLayers(map)).toHaveLength(0);
  });

  it('the legend is fetched with the token when signed in and without it when anonymous', async () => {
    setAuthToken('tok');
    fetchMock.mockResolvedValue(ok());
    const url = await fetchCatalogueLegend({ id: 'a', layerName: 'geonode:a' });
    expect(url).toBe('blob:1');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/catalogue\/a\/wms\?.*GetLegendGraphic/);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer tok' });
    setAuthToken(null);
    await fetchCatalogueLegend({ id: 'a', layerName: 'geonode:a' });
    expect(fetchMock.mock.calls[1][1].headers).toEqual({});
  });

  it('an aborted legend request creates no blob', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => { controller.abort(); return ok(); });
    await expect(fetchCatalogueLegend({ id: 'a', layerName: 'x' }, controller.signal)).rejects.toMatchObject({ code: 'ABORTED' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
