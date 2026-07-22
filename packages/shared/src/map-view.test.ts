import { describe, it, expect } from 'vitest';
import {
  VIETNAM_EXTENT_4326,
  MAP_MIN_ZOOM,
  MAP_MAX_ZOOM,
  MAP_DEFAULT_CENTER_4326,
  MAP_DEFAULT_ZOOM,
} from './map-view';

describe('map view constants', () => {
  it('spans the whole of Vietnam, not just the south-central coast', () => {
    const [minLon, minLat, maxLon, maxLat] = VIETNAM_EXTENT_4326;
    // Ca Mau (~104.8, 8.6) and Ha Giang (~105.0, 23.3) must both be inside.
    expect(minLon).toBeLessThanOrEqual(104.8);
    expect(minLat).toBeLessThanOrEqual(8.6);
    expect(maxLat).toBeGreaterThanOrEqual(23.3);
    expect(maxLon).toBeGreaterThanOrEqual(109.4);
  });

  it('orders the extent as [minLon, minLat, maxLon, maxLat]', () => {
    const [minLon, minLat, maxLon, maxLat] = VIETNAM_EXTENT_4326;
    expect(minLon).toBeLessThan(maxLon);
    expect(minLat).toBeLessThan(maxLat);
  });

  it('has a zoom floor that keeps the country in view and below the max', () => {
    expect(MAP_MIN_ZOOM).toBeGreaterThan(0);
    expect(MAP_MIN_ZOOM).toBeLessThan(MAP_MAX_ZOOM);
    expect(MAP_DEFAULT_ZOOM).toBeGreaterThanOrEqual(MAP_MIN_ZOOM);
    expect(MAP_DEFAULT_ZOOM).toBeLessThanOrEqual(MAP_MAX_ZOOM);
  });

  it('centres inside the extent', () => {
    const [lon, lat] = MAP_DEFAULT_CENTER_4326;
    const [minLon, minLat, maxLon, maxLat] = VIETNAM_EXTENT_4326;
    expect(lon).toBeGreaterThanOrEqual(minLon);
    expect(lon).toBeLessThanOrEqual(maxLon);
    expect(lat).toBeGreaterThanOrEqual(minLat);
    expect(lat).toBeLessThanOrEqual(maxLat);
  });

  // Vietnam's N-S span in EPSG:3857 is ~1,764,512 m and the country is ~2.14x
  // taller than wide, so viewport HEIGHT is the binding constraint for
  // view.fit. The zoom needed to fit that height is
  // log2(earthCircumference / (height_m * viewportHeightPx / 256)).
  // At 700/800/1000px tall that works out to ~5.96/6.15/6.47. MAP_MIN_ZOOM
  // must stay at or below all of these or the user could never zoom out
  // far enough to see the whole country.
  it('sets a zoom floor at or below the zoom needed to fit common viewport heights', () => {
    const EARTH_CIRCUMFERENCE_3857 = 2 * Math.PI * 6378137;
    const TILE_SIZE = 256;
    const [, minLat, , maxLat] = VIETNAM_EXTENT_4326;
    const latToMercatorY = (lat: number) => {
      const rad = (lat * Math.PI) / 180;
      return 6378137 * Math.log(Math.tan(Math.PI / 4 + rad / 2));
    };
    const heightMeters = latToMercatorY(maxLat) - latToMercatorY(minLat);

    for (const viewportHeightPx of [700, 800, 1000]) {
      const resolution = heightMeters / viewportHeightPx;
      const fittingZoom = Math.log2(
        EARTH_CIRCUMFERENCE_3857 / TILE_SIZE / resolution,
      );
      expect(MAP_MIN_ZOOM).toBeLessThanOrEqual(fittingZoom);
    }
  });
});
