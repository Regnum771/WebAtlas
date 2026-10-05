import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';
import type { FeatureLike } from 'ol/Feature';
import type { StyleFunction, StyleLike } from 'ol/style/Style';
import { API_BASE_URL } from '../../../shared/config';
import { apiRequest } from '../../../shared/api/apiClient';

export type WaterTileLayer = 'rivers' | 'lakes' | 'rivers_overview';
/** The administrative boundary layers, drawn from the same tile endpoint. */
export type BoundaryTileLayer = 'wards' | 'provinces';
/** `wards` and `provinces` are tokens, not dataset versions: they are optional so an older API answer still applies. */
export type WaterVersions = { rivers: string | null; lakes: string | null; wards?: string | null; provinces?: string | null };
/** Every layer served by the API's tile endpoint. The boundaries are not water layers, but share the versions request. */
export type ApiTileLayer = WaterTileLayer | BoundaryTileLayer;

/** MVT layer names of the boundary label points (the polygons are the `wards` and `provinces` MVT layers). */
export const WARD_LABEL_LAYER = 'ward_labels';
export const PROVINCE_LABEL_LAYER = 'province_labels';

/** The rivers version also keys the overview: both are drawn from the rivers layer's active version. */
const VERSION_OF: Record<ApiTileLayer, keyof WaterVersions> = {
  rivers: 'rivers', rivers_overview: 'rivers', lakes: 'lakes', wards: 'wards', provinces: 'provinces',
};

export function waterTileUrl(layer: ApiTileLayer, version: string | null): string {
  const base = `${API_BASE_URL}/api/tiles/${layer}/{z}/{x}/{y}.pbf`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

/**
 * A water layer drawn from the API's vector tiles (spec §1). Tiles hold clipped, simplified
 * geometry for drawing only: editing fetches the search endpoint's simplified geometry (SelectController).
 * renderMode 'hybrid' keeps hit detection exact for popups and selection.
 * Created hidden: nothing loads until the owner shows it (MapModel does once the active
 * versions are known), so no tile is ever fetched on its unversioned URL by accident.
 *
 * MVT features carry no usable feature id (the uuid cannot be an MVT id): popups, ROI
 * candidates, selection and the highlight all read the `id` property instead.
 */
export function createWaterTileLayer(layer: WaterTileLayer, stateId: string, style: StyleLike | StyleFunction): VectorTileLayer {
  return new VectorTileLayer({
    source: new VectorTileSource({ format: new MVT(), url: waterTileUrl(layer, null), maxZoom: 16 }),
    style,
    renderMode: 'hybrid',
    visible: false,
    declutter: false,
    properties: { id: stateId, waterTileLayer: layer },
  });
}

/**
 * A boundary layer (`layer_wards_2026`, `layer_provinces_2026`), drawn from the API's tiles. Created
 * hidden, like the water layers: MapModel shows it once the versions are known (and, for wards, the
 * zoom reaches WARDS_MIN_ZOOM). Not a water layer, so it carries no `waterTileLayer` property and is
 * never an edit target.
 */
export function createBoundaryTileLayer(layer: BoundaryTileLayer, stateId: string, style: StyleLike | StyleFunction): VectorTileLayer {
  return new VectorTileLayer({
    source: new VectorTileSource({ format: new MVT(), url: waterTileUrl(layer, null), maxZoom: 16 }),
    style,
    renderMode: 'hybrid',
    visible: false,
    // Labels are single points, one per unit, so no decluttering is needed.
    declutter: false,
    properties: { id: stateId },
  });
}

/** True for a boundary tile's label point (it carries only `code` and `name`, not the unit's attributes). */
export function isBoundaryLabel(props: Record<string, unknown>): boolean {
  return props.layer === WARD_LABEL_LAYER || props.layer === PROVINCE_LABEL_LAYER;
}

export async function fetchWaterVersions(): Promise<WaterVersions> {
  return apiRequest<WaterVersions>('/api/tiles/versions');
}

/** Point each layer at its active version; a layer whose URL would not change is not touched (no reload). */
export function applyWaterVersions(layers: Partial<Record<ApiTileLayer, VectorTileLayer>>, v: WaterVersions): void {
  for (const [name, layer] of Object.entries(layers) as Array<[ApiTileLayer, VectorTileLayer | undefined]>) {
    const source = layer?.getSource();
    if (!source) continue;
    const url = waterTileUrl(name, v[VERSION_OF[name]] ?? null);
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
