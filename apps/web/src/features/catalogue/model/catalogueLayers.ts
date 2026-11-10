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
 * A failure goes to `onFailed` (the scope decides what a 404/403 means).
 */
function createLoader(
  onFailed: (error: unknown) => void,
): { load: (wrapper: ImageWrapper, src: string) => void; abort: () => void } {
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
          onFailed(e);
          img.dispatchEvent(new Event('error'));
        },
      );
    },
  };
}

/**
 * Who owns a set of catalogue image layers on the map. Two callers draw catalogue entries: the
 * free-standing catalogue layers (CatalogueLayersSection, this store) and the catalogue links of
 * personal maps (my-maps personalLayers.ts). Each marks its OL layers with its own property and
 * a sync only ever looks at, updates or removes the layers carrying its own, so the two never
 * take each other's layers off the map, even when both show the same entry.
 */
export interface CatalogueLayerScope {
  /** The OL layer property holding the layer's key within this scope. */
  prop: string;
  /** An image of the layer with this key answered 403/404 (or another failure, `error`). */
  onDenied: (key: string, error: unknown) => void;
}

/** The free-standing catalogue layers: keyed by entry id, a denial marks the store's entry gone. */
export const CATALOGUE_SCOPE: CatalogueLayerScope = { prop: CATALOGUE_LAYER_PROP, onDenied: markGoneIfDenied };

/**
 * One catalogue layer to draw. `key` names its OL layer within the scope (default: the entry id;
 * a personal map's link uses its layer id, so one entry linked twice draws twice). `zIndex`
 * replaces the scope's own order (CATALOGUE_Z_BASE + position); `properties` are set on the OL
 * layer when it is created.
 */
export type DrawnCatalogueLayer = CatalogueLayer & { key?: string; zIndex?: number; properties?: Record<string, unknown> };

const ITEM_PROP = 'catalogueItemId';

/**
 * Keeps the scope's catalogue layers on the map in step with `layers`: one image layer per entry,
 * created once and updated in place afterwards. Only time-series layers carry TIME.
 */
export function syncCatalogueLayers(
  map: Map, layers: DrawnCatalogueLayer[], time: string | null, scope: CatalogueLayerScope = CATALOGUE_SCOPE,
): void {
  const existing = new globalThis.Map<string, ImageLayer<ImageWMS>>();
  for (const l of map.getLayers().getArray()) {
    const key = l.get(scope.prop);
    if (typeof key === 'string') existing.set(key, l as ImageLayer<ImageWMS>);
  }
  const wanted = layers.filter((l) => l.status === 'ok');
  const keyOf = (l: DrawnCatalogueLayer) => l.key ?? l.item.id;
  const wantedItem = new globalThis.Map(wanted.map((l) => [keyOf(l), l.item.id]));
  for (const [key, layer] of existing) {
    // Kept only while the same key still shows the same entry.
    if (wantedItem.get(key) === (layer.get(ITEM_PROP) ?? key)) continue;
    (layer.get(ABORT_PROP) as (() => void) | undefined)?.();
    map.removeLayer(layer);
    existing.delete(key);
  }

  wanted.forEach((entry, order) => {
    const { item, visible, opacity } = entry;
    const key = keyOf(entry);
    let layer = existing.get(key);
    if (!layer) {
      const loader = createLoader((e) => scope.onDenied(key, e));
      const source = new ImageWMS({
        url: catalogueWmsUrl(item.id),
        params: { LAYERS: item.layerName },
        ratio: 1,
        imageLoadFunction: loader.load,
      });
      layer = new ImageLayer({
        source,
        properties: { ...entry.properties, [scope.prop]: key, [ITEM_PROP]: item.id, [ABORT_PROP]: loader.abort },
      });
      map.addLayer(layer);
    }
    // A time-series layer shows its latest step at or before the slider time, and nothing before its first step.
    // Without a slider time a series layer is never drawn (it would load GeoServer's default time).
    const isSeries = item.kind === 'timeseries';
    const timeParam = isSeries && time !== null ? (stepAtOrBefore(item.timeSteps ?? [], time) ?? undefined) : undefined;
    const beforeFirst = isSeries && timeParam === undefined;
    const source = layer.getSource() as ImageWMS;
    if (source.getParams().TIME !== timeParam) source.updateParams({ TIME: timeParam });
    layer.setZIndex(entry.zIndex ?? CATALOGUE_Z_BASE + order);
    layer.setVisible(visible && !beforeFirst);
    layer.setOpacity(opacity);
  });
}
