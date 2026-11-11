import { describe, expect, it } from 'vitest';
import { contrastFailures, contrastRatio } from './contrast';
import { loadTokens } from './tokens';

describe('contrast', () => {
  it('black on white is 21', () => {
    expect(Math.abs(contrastRatio('#000000', '#FFFFFF') - 21)).toBeLessThan(1e-9);
  });

  it('#777777 on white is just under the floor', () => {
    const ratio = contrastRatio('#777777', '#FFFFFF');
    expect(ratio).toBeGreaterThanOrEqual(4.47);
    expect(ratio).toBeLessThanOrEqual(4.49);

    const tokens = loadTokens();
    const grey = {
      ...tokens,
      color: { ...tokens.color, grey: '#777777' },
      contrast: [['grey', 'surface']] as Array<[string, string]>,
    };
    expect(contrastFailures(grey)).toEqual([{ fg: 'grey', bg: 'surface', ratio }]);
  });

  it('the committed tokens pass', () => {
    // Measured 2026-11-11: the lowest pair is ink-2 on brand-tint, 5.88.
    expect(contrastFailures(loadTokens())).toEqual([]);
  });

  it('order does not matter', () => {
    expect(contrastRatio('#14532D', '#E3EFE6')).toBe(contrastRatio('#E3EFE6', '#14532D'));
  });
});
