import type { Map } from 'ol';
import Draw from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type { GeoJsonGeometry } from '@webatlas/shared';
import { olGeometryTo4326GeoJSON } from './geo';

export type DrawKind = 'Point' | 'LineString' | 'Polygon';

/**
 * One-shot draw for an analysis input. Returns a cleanup that removes the
 * interaction and its sketch layer; the caller runs it on completion or cancel.
 * The drawn shape is handed over in EPSG:4326 — the results layer redraws it as
 * an `input` geometry once the server answers.
 */
export function startAnalysisDraw(map: Map, kind: DrawKind, onDone: (g: GeoJsonGeometry) => void): () => void {
  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    zIndex: 997,
    style: {
      'stroke-color': '#1f2937', 'stroke-width': 2, 'stroke-line-dash': [8, 6],
      'fill-color': 'rgba(31, 41, 55, 0.05)', 'circle-radius': 6, 'circle-fill-color': '#1f2937',
    },
  });
  const draw = new Draw({ source, type: kind });
  draw.on('drawend', (e) => {
    const geometry = e.feature.getGeometry();
    if (geometry) onDone(olGeometryTo4326GeoJSON(geometry) as unknown as GeoJsonGeometry);
  });
  map.addLayer(layer);
  map.addInteraction(draw);
  return () => {
    map.removeInteraction(draw);
    map.removeLayer(layer);
  };
}
