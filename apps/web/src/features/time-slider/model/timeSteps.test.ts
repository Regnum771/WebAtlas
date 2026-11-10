import { describe, it, expect } from 'vitest';
import { formatStepLocal, stepAtOrBefore, unionSteps } from './timeSteps';

describe('unionSteps', () => {
  it('merges lists into sorted unique ISO steps', () => {
    const u = unionSteps([['2025-10-26T00:00:00Z'], ['2025-10-26T00:00:00Z', '2025-10-26T01:00:00Z']]);
    expect(u).toEqual(['2025-10-26T00:00:00Z', '2025-10-26T01:00:00Z']);
  });
  it('is empty for no lists', () => { expect(unionSteps([])).toEqual([]); });
});

describe('stepAtOrBefore', () => {
  const daily = ['2025-10-25T00:00:00Z', '2025-10-26T00:00:00Z'];
  it('picks the latest step at or before the time', () => {
    expect(stepAtOrBefore(daily, '2025-10-26T13:00:00Z')).toBe('2025-10-26T00:00:00Z');
    expect(stepAtOrBefore(daily, '2025-10-26T00:00:00Z')).toBe('2025-10-26T00:00:00Z');
  });
  it('is null before the first step', () => {
    expect(stepAtOrBefore(daily, '2025-10-24T12:00:00Z')).toBeNull();
    expect(stepAtOrBefore([], '2025-10-24T12:00:00Z')).toBeNull();
  });
});

describe('formatStepLocal', () => {
  it('writes dd/MM/yyyy HH:mm in local time', () => {
    const d = new Date(2025, 9, 26, 7, 5);
    expect(formatStepLocal(d.toISOString())).toBe('26/10/2025 07:05');
  });
});
