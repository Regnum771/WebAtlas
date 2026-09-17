import { describe, it, expect } from 'vitest';
import { profileStats } from './elevationProfile';

describe('profileStats', () => {
  it('computes range, ascent, descent and mean slope, skipping nodata samples', () => {
    const s = profileStats([100, 150, null, 120, 200], 1000);
    expect(s).toEqual({ min: 100, max: 200, ascentM: 130, descentM: 30, meanSlopePct: 16, valid: 4 });
  });

  it('returns null when no sample has data', () => {
    expect(profileStats([null, null], 500)).toBeNull();
  });
});
