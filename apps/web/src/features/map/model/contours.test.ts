import { describe, it, expect } from 'vitest';
import { CONTOUR_INTERVALS } from '@webatlas/shared';
import {
  contourGwcLayer,
  contourIntervalFor,
  contourStyle,
  CONTOUR_EXTENT_4326,
  CONTOUR_ATTRIBUTION,
} from './contours';
import { VIETNAM_EXTENT_4326 } from './zoomScale';

describe('contourIntervalFor', () => {
  it('is coarse when zoomed out and fine when zoomed in', () => {
    expect(contourIntervalFor(6)).toBe(250);
    expect(contourIntervalFor(9.5)).toBe(100);
    expect(contourIntervalFor(13)).toBe(50);
  });

  it('never returns an interval that was not published', () => {
    // A value outside CONTOUR_INTERVALS means a request for a GWC layer that does not
    // exist, which GeoServer answers with an exception image rather than an error.
    for (const z of [0, 5.47, 8.99, 9, 10.99, 11, 20]) {
      expect(CONTOUR_INTERVALS).toContain(contourIntervalFor(z));
    }
  });
});

describe('contourGwcLayer', () => {
  it('names the published layer for an interval', () => {
    expect(contourGwcLayer(100)).toBe('webatlas:contours_100');
  });
});

describe('contourStyle', () => {
  it('picks the labelled style only when labels are on', () => {
    expect(contourStyle(true)).toBe('webatlas:contours_labelled');
    expect(contourStyle(false)).toBe('webatlas:contours_plain');
  });

  it('qualifies the style with the workspace, which GWC WMTS requires', () => {
    // Measured against the live GeoServer: STYLE=contours_plain returns
    // 400 InvalidParameterValue; only STYLE=webatlas:contours_plain renders.
    // A bare name fails silently at the map — GeoServer answers with an exception
    // tile, not an error the browser surfaces.
    expect(contourStyle(false)).toMatch(/^webatlas:/);
  });
});

describe('CONTOUR_EXTENT_4326', () => {
  it('lies inside Vietnam\'s bounds and is non-degenerate', () => {
    const [minLon, minLat, maxLon, maxLat] = CONTOUR_EXTENT_4326;
    const [vnMinLon, vnMinLat, vnMaxLon, vnMaxLat] = VIETNAM_EXTENT_4326;

    expect(minLon).toBeLessThan(maxLon);
    expect(minLat).toBeLessThan(maxLat);

    expect(minLon).toBeGreaterThanOrEqual(vnMinLon);
    expect(maxLon).toBeLessThanOrEqual(vnMaxLon);
    expect(minLat).toBeGreaterThanOrEqual(vnMinLat);
    expect(maxLat).toBeLessThanOrEqual(vnMaxLat);
  });
});

describe('CONTOUR_ATTRIBUTION', () => {
  it('names FABDEM and Copernicus, not OpenStreetMap', () => {
    expect(CONTOUR_ATTRIBUTION).toMatch(/FABDEM/);
    expect(CONTOUR_ATTRIBUTION).toMatch(/Copernicus/);
  });
});
