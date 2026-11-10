import type Map from 'ol/Map';
import { transformExtent } from 'ol/proj';
import type { Clip4326 } from '../api/catalogue.api';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The map's current view as [minLon, minLat, maxLon, maxLat] in EPSG:4326, cut to the globe (a
 * world-wrapped view reaches past ±180), for "Cắt theo khung bản đồ hiện tại". Null when the map
 * has no size yet or the view is degenerate: the series is then not cut.
 */
export function viewExtent4326(map: Map | null): Clip4326 | null {
  const size = map?.getSize();
  if (!map || !size || !size[0] || !size[1]) return null;
  const view = map.getView();
  const [w, s, e, n] = transformExtent(view.calculateExtent(size), view.getProjection(), 'EPSG:4326');
  const box: Clip4326 = [
    round(clamp(w, -180, 180)), round(clamp(s, -90, 90)), round(clamp(e, -180, 180)), round(clamp(n, -90, 90)),
  ];
  if (!box.every(Number.isFinite) || box[0] >= box[2] || box[1] >= box[3]) return null;
  return box;
}
