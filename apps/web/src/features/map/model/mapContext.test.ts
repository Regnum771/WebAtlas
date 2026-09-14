import { describe, it, expect } from 'vitest';
import type { Map } from 'ol';
import { fromLonLat } from 'ol/proj';
import { buildMapContext } from './mapContext';

function makeMap(extent4326: [number, number, number, number], zoom = 9) {
  const [w, s, e, n] = extent4326;
  const [minX, minY] = fromLonLat([w, s]);
  const [maxX, maxY] = fromLonLat([e, n]);
  return {
    getSize: () => [800, 600],
    getView: () => ({
      calculateExtent: () => [minX, minY, maxX, maxY],
      getZoom: () => zoom,
    }),
  } as unknown as Map;
}

const LAYERS = [
  { id: 'layer_dams', visible: true, opacity: 1 },
  { id: 'layer_rivers', visible: false, opacity: 0.8 },
  { id: 'layer_lakes', visible: true, opacity: 0.85 },
];

describe('buildMapContext', () => {
  it('returns null before the map exists', () => {
    expect(buildMapContext({ map: null, basemap: 'street', layersState: LAYERS })).toBeNull();
  });

  it('reports the viewport in WGS84 degrees, not Web Mercator metres', () => {
    const ctx = buildMapContext({ map: makeMap([107.5, 12.0, 109.0, 13.5]), basemap: 'street', layersState: LAYERS });
    expect(ctx!.bbox[0]).toBeCloseTo(107.5, 4);
    expect(ctx!.bbox[3]).toBeCloseTo(13.5, 4);
  });

  it('rounds the zoom to two decimals so an identical view yields an identical context', () => {
    const ctx = buildMapContext({ map: makeMap([107.5, 12.0, 109.0, 13.5], 9.123456), basemap: 'street', layersState: LAYERS });
    expect(ctx!.zoom).toBe(9.12);
  });

  it('lists only the visible layers', () => {
    const ctx = buildMapContext({ map: makeMap([107.5, 12.0, 109.0, 13.5]), basemap: 'satellite', layersState: LAYERS });
    expect(ctx!.visibleLayerStateIds).toEqual(['layer_dams', 'layer_lakes']);
    expect(ctx!.basemap).toBe('satellite');
  });

  it('returns null when the view has no zoom yet', () => {
    const map = {
      getSize: () => [800, 600],
      getView: () => ({ calculateExtent: () => [0, 0, 1, 1], getZoom: () => undefined }),
    } as unknown as Map;
    expect(buildMapContext({ map, basemap: 'street', layersState: LAYERS })).toBeNull();
  });
});
