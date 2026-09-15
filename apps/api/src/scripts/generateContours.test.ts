import { describe, it, expect } from 'vitest';
import { CONTOUR_INTERVALS } from '@webatlas/shared';
import { cellsCovering, isIndexContour } from './generateContours';

describe('cellsCovering', () => {
  it('returns whole-degree cells covering the bounds, inclusive of partial edges', () => {
    // The DEM extent is 107.20-109.46 E, 10.57-16.22 N: partial cells at every edge
    // must still be generated or the contours stop short of the region boundary.
    const cells = cellsCovering({ west: 107.2, south: 10.57, east: 109.46, north: 12.2 });
    expect(cells).toContainEqual({ lon: 107, lat: 10 });
    expect(cells).toContainEqual({ lon: 109, lat: 12 });
    expect(cells).toHaveLength(3 * 3);
  });
});

describe('isIndexContour', () => {
  it('marks every fifth contour, which is the one that gets a label', () => {
    expect(isIndexContour(500, 100)).toBe(true);
    expect(isIndexContour(400, 100)).toBe(false);
    expect(isIndexContour(1250, 250)).toBe(true);
  });

  it('is not fooled by floating point, because ST_Contour returns float elevations', () => {
    // 1500.0000001 is the same contour as 1500 as far as a reader is concerned.
    expect(isIndexContour(1500.0000001, 100)).toBe(true);
  });

  it('treats sea level as an index contour', () => {
    expect(isIndexContour(0, 50)).toBe(true);
  });
});

describe('CONTOUR_INTERVALS', () => {
  it('ships coarse-to-fine, and does not include 20 m yet', () => {
    // 20 m is ~445,000 features and ~230 MB region-wide: decided after 50 m is on screen.
    expect(CONTOUR_INTERVALS).toEqual([250, 100, 50]);
  });
});
