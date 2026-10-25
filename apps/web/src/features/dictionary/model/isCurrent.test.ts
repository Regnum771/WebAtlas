import { describe, it, expect } from 'vitest';
import { isCurrent, localToday } from './isCurrent';

describe('isCurrent', () => {
  it('is current without an end date or before it, retired on or after it', () => {
    expect(isCurrent(undefined, '2026-10-25')).toBe(true);
    expect(isCurrent('2026-10-26', '2026-10-25')).toBe(true);
    expect(isCurrent('2026-10-25', '2026-10-25')).toBe(false);
    expect(isCurrent('2000-01-01', '2026-10-25')).toBe(false);
  });

  it('localToday is a YYYY-MM-DD date', () => {
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
