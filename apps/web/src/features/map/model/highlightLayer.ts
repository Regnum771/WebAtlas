import type { Map } from 'ol';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import type { HighlightPoint } from '@webatlas/shared';

/** Identifies the layer in the OL layer stack. Deliberately NOT a member of
 *  LAYER_STATE_IDS: this layer is transient assistant output, not a data layer
 *  the user can toggle, so it must never appear in the layers panel. */
export const HIGHLIGHT_LAYER_ID = 'layer_assistant_highlight';

/** Kept local rather than added to styles.ts: nothing else highlights points,
 *  and the style only exists because this layer does. */
const highlightStyle = (feature: { get: (key: string) => unknown }) =>
  new Style({
    image: new Circle({
      radius: 9,
      fill: new Fill({ color: 'rgba(217, 119, 6, 0.35)' }),
      stroke: new Stroke({ color: '#b45309', width: 2 }),
    }),
    text: new Text({
      text: (feature.get('label') as string | undefined) ?? '',
      offsetY: -18,
      font: '12px sans-serif',
      fill: new Fill({ color: '#78350f' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
    }),
  });

// Keyed by map so a remounted map gets its own layer and the old one is
// collected with it — a module-level singleton would leak across MapModel
// teardown/rebuild and re-add a layer to a disposed map.
const layers = new WeakMap<Map, VectorLayer<VectorSource>>();

function ensureLayer(map: Map): VectorLayer<VectorSource> {
  const existing = layers.get(map);
  if (existing) return existing;
  const layer = new VectorLayer({
    source: new VectorSource(),
    style: highlightStyle as never,
    properties: { id: HIGHLIGHT_LAYER_ID },
    // Above every data layer: a highlight that renders under the rivers it
    // points at is not a highlight.
    zIndex: 999,
  });
  map.addLayer(layer);
  layers.set(map, layer);
  return layer;
}

/** Replaces whatever is currently highlighted with `points`. */
export function showHighlights(map: Map, points: HighlightPoint[]): void {
  const source = ensureLayer(map).getSource();
  if (!source) return;
  source.clear();
  source.addFeatures(
    points.map(
      (p) =>
        new Feature({
          geometry: new Point(fromLonLat(p.lonLat)),
          label: p.label ?? '',
        })
    )
  );
}

/** Empties the highlight source. Leaves the (empty) layer in place — removing
 *  and re-adding it on every clear would churn the layer stack for nothing. */
export function clearHighlights(map: Map): void {
  layers.get(map)?.getSource()?.clear();
}
