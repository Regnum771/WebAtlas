import { getCenter } from 'ol/extent';
import type { Map } from 'ol';
import type { Geometry } from 'ol/geom';

// Fly the map to a feature's geometry, centred on its EXTENT centre so it works
// for ANY geometry — point, line, polygon. (Using getCoordinates() breaks on
// lines/polygons, which return nested arrays that are not a valid view centre.)
export function flyToGeometry(map: Map | null, geom: Geometry | null | undefined, zoom = 11): void {
  if (!map || !geom) return;
  const center = getCenter(geom.getExtent());
  map.getView().animate({ center, zoom, duration: 1000 });
}
