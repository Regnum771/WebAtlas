import { describe, it, expect } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('uses binary units, a decimal comma, and no decimal for whole numbers', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
    expect(formatBytes(12897484)).toBe('12,3 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(0)).toBe('0 KB');
    // The unit is picked after rounding, so a value that rounds up to 1024 moves to the next unit.
    expect(formatBytes(1048575)).toBe('1 MB');
  });
});
