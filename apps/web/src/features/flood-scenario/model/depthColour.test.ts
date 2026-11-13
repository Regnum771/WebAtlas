import { describe, it, expect } from 'vitest';
import { DICTIONARY, attributeOf } from '@webatlas/shared';
import { DEPTH_BANDS, depthAt, depthOfRgba, formatDepth, pixelOf } from './depthColour';

// Colours printed by packages/atlas-data/tools/flood_scenario/depth.py's depth_rgba: the two tables must agree.
const FROM_PYTHON: [number, number[]][] = [
  [0.25, [201, 195, 234, 200]], [0.5, [154, 143, 214, 200]], [0.75, [155, 143, 214, 200]],
  [1.0, [107, 91, 184, 200]], [1.75, [110, 91, 184, 200]], [2.0, [63, 46, 140, 200]],
  [2.75, [66, 46, 140, 200]], [3.0, [38, 26, 92, 200]], [4.0, [42, 26, 92, 200]],
];

describe('depthOfRgba', () => {
  it('reads the 0.25 m step back from the frame colours the build writes', () => {
    for (const [m, rgba] of FROM_PYTHON) expect(depthOfRgba(rgba)).toBe(m);
  });

  it('is null for a dry pixel or a colour no step uses', () => {
    expect(depthOfRgba([0, 0, 0, 0])).toBeNull();
    expect(depthOfRgba([1, 2, 3, 200])).toBeNull();
  });
});

describe('pixelOf', () => {
  it('maps a map coordinate to its pixel in the frame, top-left origin', () => {
    expect(pixelOf([0, 0, 100, 50], 200, 100, [50, 25])).toEqual([100, 50]);
    expect(pixelOf([0, 0, 100, 50], 200, 100, [0, 50])).toEqual([0, 0]);
    expect(pixelOf([0, 0, 100, 50], 200, 100, [101, 25])).toBeNull();
  });
});

describe('depthAt', () => {
  it('reads the depth under a coordinate from a frame image', () => {
    const data = new Uint8ClampedArray(2 * 1 * 4);
    data.set([110, 91, 184, 200], 4); // pixel (1, 0) is 1.75 m
    const frame = { width: 2, height: 1, data };
    expect(depthAt(frame, [0, 0, 2, 1], [1.5, 0.5])).toBe(1.75);
    expect(depthAt(frame, [0, 0, 2, 1], [0.5, 0.5])).toBeNull();
  });
});

describe('formatDepth and the legend bands', () => {
  it('flood depth uses the band display unit and keeps the 4 m cap', () => {
    const m = attributeOf(DICTIONARY, 'flood_depth', '1')!;
    expect(formatDepth(1.75, m)).toBe('1,75 m');
    expect(formatDepth(4, m)).toBe('≥ 4 m');
    const cm = { ...m, displayUnit: 'cm' };
    expect(formatDepth(1.75, cm)).toBe('175 cm');
    expect(formatDepth(4, cm)).toBe('≥ 400 cm');
  });

  it('has five bands with labels for the legend', () => {
    expect(DEPTH_BANDS.map((b) => b.label)).toEqual(['< 0,5 m', '0,5–1 m', '1–2 m', '2–3 m', '≥ 3 m']);
    expect(DEPTH_BANDS.map((b) => b.css)).toEqual(['#c9c3ea', '#9a8fd6', '#6b5bb8', '#3f2e8c', '#261a5c']);
  });
});
