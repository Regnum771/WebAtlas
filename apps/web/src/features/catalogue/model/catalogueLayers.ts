import type Map from 'ol/Map';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type ImageWrapper from 'ol/Image';
import { catalogueWmsUrl, fetchCatalogueBlob } from '../api/catalogue.api';
import type { CatalogueLayer } from './catalogue.store';

/** Below the personal layers (800+), above the base data. */
export const CATALOGUE_Z_BASE = 700;
export const CATALOGUE_LAYER_PROP = 'catalogueId';

/**
 * Loads a map image through fetch so the Bearer token goes with it (an unpublished entry is
 * visible to its owner only); the blob URL is revoked as soon as the image has loaded or failed.
 */
function tokenImageLoad(wrapper: ImageWrapper, src: string): void {
  const img = wrapper.getImage() as HTMLImageElement;
  fetchCatalogueBlob(src).then(
    (blobUrl) => {
      const revoke = () => URL.revokeObjectURL(blobUrl);
      img.addEventListener('load', revoke, { once: true });
      img.addEventListener('error', revoke, { once: true });
      img.src = blobUrl;
    },
    () => { img.dispatchEvent(new Event('error')); },
  );
}

/**
 * Keeps the map's catalogue layers in step with the store: one image layer per entry, created
 * once and updated in place afterwards. Only time-series layers carry TIME.
 */
export function syncCatalogueLayers(map: Map, layers: CatalogueLayer[], time: string | null): void {
  const existing = new globalThis.Map<string, ImageLayer<ImageWMS>>();
  for (const l of map.getLayers().getArray()) {
    const id = l.get(CATALOGUE_LAYER_PROP);
    if (typeof id === 'string') existing.set(id, l as ImageLayer<ImageWMS>);
  }
  const wanted = layers.filter((l) => l.status === 'ok');
  const wantedIds = new Set(wanted.map((l) => l.item.id));
  for (const [id, layer] of existing) if (!wantedIds.has(id)) map.removeLayer(layer);

  wanted.forEach(({ item, visible, opacity }, order) => {
    let layer = existing.get(item.id);
    if (!layer) {
      const source = new ImageWMS({
        url: catalogueWmsUrl(item.id),
        params: { LAYERS: item.layerName },
        ratio: 1,
        imageLoadFunction: tokenImageLoad,
      });
      layer = new ImageLayer({ source, properties: { [CATALOGUE_LAYER_PROP]: item.id } });
      map.addLayer(layer);
    }
    const timeParam = item.kind === 'timeseries' && time ? time : undefined;
    const source = layer.getSource() as ImageWMS;
    if (source.getParams().TIME !== timeParam) source.updateParams({ TIME: timeParam });
    layer.setZIndex(CATALOGUE_Z_BASE + order);
    layer.setVisible(visible);
    layer.setOpacity(opacity);
  });
}
