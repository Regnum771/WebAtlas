import { describe, it, expect } from 'vitest';
import { formatLonLat } from './mapReadouts';

describe('formatLonLat', () => {
  it('prints longitude first with hemisphere suffixes, like the reference atlas', () => {
    expect(formatLonLat([108.044712, 12.679734])).toBe('108.044712°E  12.679734°N');
  });

  it('uses six decimals — enough to name a point, stable enough to copy', () => {
    expect(formatLonLat([108.1, 12.2])).toBe('108.100000°E  12.200000°N');
  });

  it('uses W and S below zero rather than a minus sign', () => {
    expect(formatLonLat([-58.38, -34.6])).toBe('58.380000°W  34.600000°S');
  });

  it('survives a coordinate the map has not produced yet', () => {
    expect(formatLonLat([])).toBe('');
  });
});
