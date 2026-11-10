import { describe, it, expect } from 'vitest';
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
    expect(t2.getSource()?.getParams().TIME).toBe('2026-01-02T00:00:00Z');
    syncCatalogueLayers(map, [layer('t', 'timeseries')], null);
    expect(catLayers(map)[0].getSource()?.getParams().TIME).toBeUndefined();
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
