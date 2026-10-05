import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';
import type { FeatureLike } from 'ol/Feature';
import type { StyleFunction, StyleLike } from 'ol/style/Style';
import { API_BASE_URL } from '../../../shared/config';
import { apiRequest } from '../../../shared/api/apiClient';

export type WaterTileLayer = 'rivers' | 'lakes' | 'rivers_overview';
export type WaterVersions = { rivers: string | null; lakes: string | null };

/** The rivers version also keys the overview: both are drawn from the rivers layer's active version. */
const VERSION_OF: Record<WaterTileLayer, keyof WaterVersions> = { rivers: 'rivers', rivers_overview: 'rivers', lakes: 'lakes' };

export function waterTileUrl(layer: WaterTileLayer, version: string | null): string {
  const base = `${API_BASE_URL}/api/tiles/${layer}/{z}/{x}/{y}.pbf`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

/**
 * A water layer drawn from the API's vector tiles (spec §1). Tiles hold clipped, simplified
 * geometry for drawing only: editing fetches the full geometry (SelectController).
 * renderMode 'hybrid' keeps hit detection exact for popups and selection.
 *
 * MVT features carry no usable feature id (the uuid cannot be an MVT id): popups, ROI
 * candidates, selection and the highlight all read the `id` property instead.
 */
export function createWaterTileLayer(layer: WaterTileLayer, stateId: string, style: StyleLike | StyleFunction): VectorTileLayer {
  return new VectorTileLayer({
    source: new VectorTileSource({ format: new MVT(), url: waterTileUrl(layer, null), maxZoom: 16 }),
    style,
    renderMode: 'hybrid',
    declutter: false,
    properties: { id: stateId, waterTileLayer: layer },
  });
}

export async function fetchWaterVersions(): Promise<WaterVersions> {
  return apiRequest<WaterVersions>('/api/tiles/versions');
}

/** Point each layer at its active version; a layer whose URL would not change is not touched (no reload). */
export function applyWaterVersions(layers: Partial<Record<WaterTileLayer, VectorTileLayer>>, v: WaterVersions): void {
  for (const [name, layer] of Object.entries(layers) as Array<[WaterTileLayer, VectorTileLayer | undefined]>) {
    const source = layer?.getSource();
    if (!source) continue;
    const url = waterTileUrl(name, v[VERSION_OF[name]]);
    if (source.getUrls()?.[0] !== url) source.setUrl(url);
  }
}

/**
 * Wraps a tile layer's style so the feature whose `id` property is selected draws with
 * `highlight`. This replaces ol/interaction/Select for tile layers, which never selects
 * tile features. A river clipped across several tiles highlights in every tile at once.
 * Call `layer.changed()` after the selection changes so the tiles redraw.
 */
export function withHighlight(
  base: StyleFunction,
  highlight: StyleFunction,
  selectedId: () => string | null,
): StyleFunction {
  return (feature: FeatureLike, resolution: number) => {
    const id = selectedId();
    return id !== null && feature.get('id') === id ? highlight(feature, resolution) : base(feature, resolution);
  };
}
