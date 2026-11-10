import type Map from 'ol/Map';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type ImageWrapper from 'ol/Image';
import { catalogueWmsUrl, fetchCatalogueBlob } from '../api/catalogue.api';
import { stepAtOrBefore } from '../../time-slider/model/timeSteps';
import { markGoneIfDenied, type CatalogueLayer } from './catalogue.store';

/** Below the personal layers (800+), above the base data. */
export const CATALOGUE_Z_BASE = 700;
export const CATALOGUE_LAYER_PROP = 'catalogueId';

const ABORT_PROP = 'catalogueAbort';

/**
 * An image load function for one layer. It loads through fetch so the Bearer token goes with it
 * (an unpublished entry is visible to its owner only). A new request aborts the previous one, so
 * a superseded image never lands; the blob URL is revoked once the image has loaded or failed.
 * A 404/403 marks the layer gone.
 */
function createLoader(id: string): { load: (wrapper: ImageWrapper, src: string) => void; abort: () => void } {
  let current: AbortController | null = null;
  return {
    abort: () => { current?.abort(); current = null; },
    load(wrapper, src) {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      const img = wrapper.getImage() as HTMLImageElement;
      fetchCatalogueBlob(src, controller.signal).then(
        (blobUrl) => {
          if (controller.signal.aborted) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          const revoke = () => URL.revokeObjectURL(blobUrl);
          img.addEventListener('load', revoke, { once: true });
          img.addEventListener('error', revoke, { once: true });
          img.src = blobUrl;
        },
        (e) => {
          if (controller.signal.aborted) return;
          markGoneIfDenied(id, e);
          img.dispatchEvent(new Event('error'));
        },
      );
    },
  };
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
  for (const [id, layer] of existing) {
    if (wantedIds.has(id)) continue;
    (layer.get(ABORT_PROP) as (() => void) | undefined)?.();
    map.removeLayer(layer);
  }

  wanted.forEach(({ item, visible, opacity }, order) => {
    let layer = existing.get(item.id);
    if (!layer) {
      const loader = createLoader(item.id);
      const source = new ImageWMS({
        url: catalogueWmsUrl(item.id),
        params: { LAYERS: item.layerName },
        ratio: 1,
        imageLoadFunction: loader.load,
      });
      layer = new ImageLayer({ source, properties: { [CATALOGUE_LAYER_PROP]: item.id, [ABORT_PROP]: loader.abort } });
      map.addLayer(layer);
    }
    // A time-series layer shows its latest step at or before the slider time, and nothing before its first step.
    // Without a slider time a series layer is never drawn (it would load GeoServer's default time).
    const isSeries = item.kind === 'timeseries';
    const timeParam = isSeries && time !== null ? (stepAtOrBefore(item.timeSteps ?? [], time) ?? undefined) : undefined;
    const beforeFirst = isSeries && timeParam === undefined;
    const source = layer.getSource() as ImageWMS;
    if (source.getParams().TIME !== timeParam) source.updateParams({ TIME: timeParam });
    layer.setZIndex(CATALOGUE_Z_BASE + order);
    layer.setVisible(visible && !beforeFirst);
    layer.setOpacity(opacity);
  });
}
