import { describe, it, expect, vi } from 'vitest';
import OlMap from 'ol/Map';
import TileLayer from 'ol/layer/Tile';
import TileWMS from 'ol/source/TileWMS';

// jsdom does not implement ResizeObserver, but ol/Map's constructor requires it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

import { addWmsOverlay } from './wmsOverlay';

const LAYER = { url: 'https://example.com/geoserver/wms', layerName: 'ws:rivers' };

function setup() {
  const map = new OlMap({});
  const onError = vi.fn();
  addWmsOverlay(map, LAYER, onError);
  const layer = map.getLayers().getArray()[0] as TileLayer<TileWMS>;
  return { map, onError, layer, source: layer.getSource()! };
}

describe('addWmsOverlay', () => {
  it('adds one WMS tile layer for the address and the layer name', () => {
    const { map, layer, source } = setup();
    expect(map.getLayers().getLength()).toBe(1);
    expect(layer).toBeInstanceOf(TileLayer);
    expect(source).toBeInstanceOf(TileWMS);
    expect(source.getUrls()).toEqual([LAYER.url]);
    expect(source.getParams()).toMatchObject({ LAYERS: 'ws:rivers', TILED: true });
    expect(String(layer.get('id'))).toMatch(/^wms_\d+$/);
  });

  it('removes the layer and reports once when the first tile fails', () => {
    const { map, onError, source } = setup();
    source.dispatchEvent('tileloaderror');
    source.dispatchEvent('tileloaderror');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(map.getLayers().getLength()).toBe(0);
  });

  it('keeps the layer when a tile has already loaded', () => {
    const { map, onError, layer, source } = setup();
    source.dispatchEvent('tileloadend');
    source.dispatchEvent('tileloaderror');
    expect(onError).not.toHaveBeenCalled();
    expect(map.getLayers().getArray()).toEqual([layer]);
  });
});
