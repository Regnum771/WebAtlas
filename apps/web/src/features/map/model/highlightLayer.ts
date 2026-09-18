import type { Map } from 'ol';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat } from 'ol/proj';
import { createEmpty, extend, isEmpty } from 'ol/extent';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import type { HighlightPoint, ResultGeometry, ResultRole } from '@webatlas/shared';

/** Identifies the layer in the OL layer stack. Deliberately NOT a member of
 *  LAYER_STATE_IDS: this layer is transient assistant output, not a data layer
 *  the user can toggle, so it must never appear in the layers panel. */
export const HIGHLIGHT_LAYER_ID = 'layer_assistant_highlight';

/** Lines, polygons and analysis output (search, toolbar, assistant). Same rule as
 *  above: transient, never in the layers panel. */
export const RESULTS_LAYER_ID = 'layer_analysis_results';

const labelText = (text: string) =>
  new Text({
    text,
    offsetY: -18,
    font: '12px sans-serif',
    fill: new Fill({ color: '#78350f' }),
    stroke: new Stroke({ color: '#ffffff', width: 3 }),
    overflow: true,
  });

/** Kept local rather than added to styles.ts: nothing else highlights points,
 *  and the style only exists because this layer does. */
const highlightStyle = (feature: { get: (key: string) => unknown }) =>
  new Style({
    image: new Circle({
      radius: 9,
      fill: new Fill({ color: 'rgba(217, 119, 6, 0.35)' }),
      stroke: new Stroke({ color: '#b45309', width: 2 }),
    }),
    text: labelText((feature.get('label') as string | undefined) ?? ''),
  });

const ROLE_STYLE: Record<ResultRole, { stroke: Stroke; fill: Fill }> = {
  highlight: { stroke: new Stroke({ color: '#d97706', width: 4 }), fill: new Fill({ color: 'rgba(217, 119, 6, 0.15)' }) },
  input: { stroke: new Stroke({ color: '#1f2937', width: 2, lineDash: [8, 6] }), fill: new Fill({ color: 'rgba(31, 41, 55, 0.05)' }) },
  result: { stroke: new Stroke({ color: '#1d4ed8', width: 2 }), fill: new Fill({ color: 'rgba(37, 99, 235, 0.25)' }) },
};

const resultStyle = (feature: { get: (key: string) => unknown }) => {
  const role = (feature.get('role') as ResultRole | undefined) ?? 'result';
  const { stroke, fill } = ROLE_STYLE[role];
  return new Style({
    stroke,
    fill,
    image: new Circle({ radius: 7, fill, stroke }),
    text: labelText((feature.get('label') as string | undefined) ?? ''),
  });
};

// Keyed by map so a remounted map gets its own layer and the old one is
// collected with it — a module-level singleton would leak across MapModel
// teardown/rebuild and re-add a layer to a disposed map.
const highlightLayers = new WeakMap<Map, VectorLayer<VectorSource>>();
const resultLayers = new WeakMap<Map, VectorLayer<VectorSource>>();

function ensureLayer(
  map: Map,
  registry: WeakMap<Map, VectorLayer<VectorSource>>,
  id: string,
  style: unknown,
  zIndex: number,
): VectorLayer<VectorSource> {
  const existing = registry.get(map);
  if (existing) return existing;
  const layer = new VectorLayer({ source: new VectorSource(), style: style as never, properties: { id }, zIndex });
  map.addLayer(layer);
  registry.set(map, layer);
  return layer;
}

/** Replaces whatever is currently highlighted with `points`. */
export function showHighlights(map: Map, points: HighlightPoint[]): void {
  // Above every data layer: a highlight that renders under the rivers it
  // points at is not a highlight.
  const source = ensureLayer(map, highlightLayers, HIGHLIGHT_LAYER_ID, highlightStyle, 999).getSource();
  if (!source) return;
  source.clear();
  source.addFeatures(
    points.map((p) => new Feature({ geometry: new Point(fromLonLat(p.lonLat)), label: p.label ?? '' }))
  );
}

const format = new GeoJSON();

/** Replaces the drawn results with `items`; with `fit`, frames them all. */
export function showResults(map: Map, items: ResultGeometry[], fit: boolean): void {
  const source = ensureLayer(map, resultLayers, RESULTS_LAYER_ID, resultStyle, 998).getSource();
  if (!source) return;
  source.clear();
  const extent = createEmpty();
  for (const item of items) {
    const geometry = format.readGeometry(item.geometry, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    });
    extend(extent, geometry.getExtent());
    source.addFeature(new Feature({ geometry, role: item.role, label: item.label ?? '' }));
  }
  if (fit && !isEmpty(extent)) {
    map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 14, duration: 400 });
  }
}

/** Empties both transient layers. Leaves the (empty) layers in place — removing
 *  and re-adding them on every clear would churn the layer stack for nothing. */
export function clearHighlights(map: Map): void {
  highlightLayers.get(map)?.getSource()?.clear();
  resultLayers.get(map)?.getSource()?.clear();
}
