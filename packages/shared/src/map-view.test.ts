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
});
