import type { Map } from 'ol';
import Feature from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { containsExtent } from 'ol/extent';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import type { GeoJsonGeometry } from '@webatlas/shared';

/** Not a LAYER_STATE_ID: the ROI is not a data layer the user toggles. */
export const ROI_LAYER_ID = 'layer_roi';

// U-7: dark dashed outline, faint fill — distinct from the blue drawing sketch and the
// amber/blue result highlights (highlightLayer.ts).
const stroke = new Stroke({ color: '#1f2937', width: 2.5, lineDash: [10, 6] });
const fill = new Fill({ color: 'rgba(31, 41, 55, 0.08)' });
const style = (feature: { get: (k: string) => unknown }) =>
  new Style({
    stroke,
    fill,
    image: new Circle({ radius: 8, fill: new Fill({ color: 'rgba(31, 41, 55, 0.25)' }), stroke }),
    text: new Text({
      text: (feature.get('label') as string | undefined) ?? '',
      offsetY: -18,
      font: '600 12px sans-serif',
      fill: new Fill({ color: '#111827' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
      overflow: true,
    }),
  });

const layers = new WeakMap<Map, VectorLayer<VectorSource>>();
const format = new GeoJSON();

function ensureLayer(map: Map): VectorLayer<VectorSource> {
  const existing = layers.get(map);
  if (existing) return existing;
  // Below the analysis results (998) and highlights (999): a result drawn inside the ROI
  // must stay visible on top of it.
  const layer = new VectorLayer({ source: new VectorSource(), style, properties: { id: ROI_LAYER_ID }, zIndex: 997 });
  map.addLayer(layer);
  layers.set(map, layer);
  return layer;
}

export function getRoiLayer(map: Map): VectorLayer<VectorSource> | undefined {
  return layers.get(map);
}

/** Replaces the drawn ROI. `fit`: always, never, or only if it is not wholly in view. */
export function drawRoi(map: Map, geometry: GeoJsonGeometry, label: string, fit: boolean | 'ifOutside'): void {
  const source = ensureLayer(map).getSource()!;
  source.clear();
  const g = format.readGeometry(geometry, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
  source.addFeature(new Feature({ geometry: g, label }));
  const view = map.getView();
  const size = map.getSize();
  const inView = size ? containsExtent(view.calculateExtent(size), g.getExtent()) : false;
  if (fit === true || (fit === 'ifOutside' && !inView)) {
    // Bottom padding clears the toolbar, the chip and a result card.
    view.fit(g.getExtent(), { padding: [80, 80, 200, 80], maxZoom: 13, duration: 400 });
  }
}

export function eraseRoi(map: Map): void {
  layers.get(map)?.getSource()?.clear();
}
