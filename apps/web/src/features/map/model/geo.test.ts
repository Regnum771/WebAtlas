import { describe, it, expect } from 'vitest';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { olGeometryTo4326GeoJSON, geoJSON4326ToOlGeometry } from './geo';

describe('geo helpers', () => {
  it('converts an OL Point (3857) to a 4326 GeoJSON geometry', () => {
    const geom = new Point(fromLonLat([108.2, 13.5])); // 3857 meters
    const gj = olGeometryTo4326GeoJSON(geom);
    expect(gj.type).toBe('Point');
    const [lon, lat] = gj.coordinates as [number, number];
    expect(lon).toBeCloseTo(108.2, 4);
    expect(lat).toBeCloseTo(13.5, 4);
  });

  it('does not mutate the source geometry (works on a clone)', () => {
    const geom = new Point(fromLonLat([108.2, 13.5]));
    const before = geom.getCoordinates().slice();
    olGeometryTo4326GeoJSON(geom);
    expect(geom.getCoordinates()).toEqual(before);
  });

  it('round-trips 4326 GeoJSON -> OL (3857) -> 4326 GeoJSON', () => {
    const gj = { type: 'Point', coordinates: [108.2, 13.5] };
    const ol = geoJSON4326ToOlGeometry(gj);
    const back = olGeometryTo4326GeoJSON(ol);
    const [lon, lat] = back.coordinates as [number, number];
    expect(lon).toBeCloseTo(108.2, 4);
    expect(lat).toBeCloseTo(13.5, 4);
  });
});
