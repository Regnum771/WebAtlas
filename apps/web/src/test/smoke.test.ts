import { describe, it, expect } from 'vitest';

describe('web test harness', () => {
  it('runs vitest with jsdom (localStorage available)', () => {
    localStorage.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    expect(typeof window).toBe('object');
  });
});
