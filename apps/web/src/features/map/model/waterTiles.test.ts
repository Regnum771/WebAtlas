import { describe, it, expect, vi, afterEach } from 'vitest';
import Feature from 'ol/Feature';
import { Style } from 'ol/style';
import VectorTileLayer from 'ol/layer/VectorTile';
import { applyWaterVersions, createBoundaryTileLayer, createWaterTileLayer, isBoundaryLabel, fetchWaterVersions, waterTileUrl, withHighlight } from './waterTiles';
import { API_BASE_URL } from '../../../shared/config';

afterEach(() => vi.unstubAllGlobals());

describe('waterTileUrl', () => {
  it('names the layer and carries the version so the browser can cache the tile for good', () => {
    expect(waterTileUrl('rivers', 'abc')).toBe(`${API_BASE_URL}/api/tiles/rivers/{z}/{x}/{y}.pbf?v=abc`);
    expect(waterTileUrl('lakes', null)).toBe(`${API_BASE_URL}/api/tiles/lakes/{z}/{x}/{y}.pbf`);
  });
});

describe('createWaterTileLayer', () => {
  it('starts hidden, so nothing loads before its owner shows it', () => {
    expect(createWaterTileLayer('rivers', 'layer_rivers', () => undefined).getVisible()).toBe(false);
  });
});

describe('applyWaterVersions', () => {
  it('points rivers and the overview at the rivers version, lakes at the lakes version', () => {
    const rivers = createWaterTileLayer('rivers', 'layer_rivers', () => undefined);
    const overview = createWaterTileLayer('rivers_overview', 'layer_rivers_overview', () => undefined);
    const lakes = createWaterTileLayer('lakes', 'layer_lakes', () => undefined);
    applyWaterVersions({ rivers, rivers_overview: overview, lakes }, { rivers: 'r1', lakes: 'l1' });
    expect(rivers.getSource()!.getUrls()).toEqual([waterTileUrl('rivers', 'r1')]);
    expect(overview.getSource()!.getUrls()).toEqual([waterTileUrl('rivers_overview', 'r1')]);
    expect(lakes.getSource()!.getUrls()).toEqual([waterTileUrl('lakes', 'l1')]);
  });

  it('leaves a layer alone when its version did not change, so nothing reloads', () => {
    const lakes = createWaterTileLayer('lakes', 'layer_lakes', () => undefined);
    applyWaterVersions({ lakes }, { rivers: null, lakes: 'l1' });
    const setUrl = vi.spyOn(lakes.getSource()!, 'setUrl');
    applyWaterVersions({ lakes }, { rivers: null, lakes: 'l1' });
    expect(setUrl).not.toHaveBeenCalled();
  });
});

describe('fetchWaterVersions', () => {
  it('reads /api/tiles/versions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ rivers: 'r1', lakes: 'l1' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchWaterVersions()).toEqual({ rivers: 'r1', lakes: 'l1' });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/tiles/versions`);
  });
});

describe('withHighlight', () => {
  const base = new Style();
  const highlight = new Style();
  const style = (selected: string | null) => withHighlight(() => base, () => highlight, () => selected);

  it('draws the feature whose id property is selected with the highlight style', () => {
    expect(style('u1')(new Feature({ id: 'u1' }), 10)).toBe(highlight);
  });

  it('draws every other feature, and everything when nothing is selected, with the base style', () => {
    expect(style('u1')(new Feature({ id: 'u2' }), 10)).toBe(base);
    expect(style(null)(new Feature({ id: 'u1' }), 10)).toBe(base);
  });
});

describe('boundary tile layers', () => {
  it.each([
    ['wards', 'layer_wards_2026', 'w1'],
    ['provinces', 'layer_provinces_2026', 'p1'],
  ] as const)('%s: a hidden VectorTile layer on its versioned URL, and not an editable water layer', (name, stateId, token) => {
    const layer = createBoundaryTileLayer(name, stateId, () => undefined);
    expect(layer).toBeInstanceOf(VectorTileLayer);
    expect(layer.getVisible()).toBe(false);
    expect(layer.get('id')).toBe(stateId);
    expect(layer.get('waterTileLayer')).toBeUndefined();
    applyWaterVersions({ [name]: layer }, { rivers: null, lakes: null, wards: 'w1', provinces: 'p1' });
    expect(layer.getSource()!.getUrls()).toEqual([`${API_BASE_URL}/api/tiles/${name}/{z}/{x}/{y}.pbf?v=${token}`]);
  });

  it('keeps the unversioned URL when an older API answers without a provinces token', () => {
    const provinces = createBoundaryTileLayer('provinces', 'layer_provinces_2026', () => undefined);
    applyWaterVersions({ provinces }, { rivers: 'r1', lakes: 'l1' });
    expect(provinces.getSource()!.getUrls()).toEqual([`${API_BASE_URL}/api/tiles/provinces/{z}/{x}/{y}.pbf`]);
  });

  it('tells a label point from a boundary polygon by its MVT layer', () => {
    expect(isBoundaryLabel({ layer: 'ward_labels', code: '1' })).toBe(true);
    expect(isBoundaryLabel({ layer: 'province_labels', code: '66' })).toBe(true);
    expect(isBoundaryLabel({ layer: 'wards', code: '1' })).toBe(false);
    expect(isBoundaryLabel({ layer: 'provinces', code: '66' })).toBe(false);
  });
});
