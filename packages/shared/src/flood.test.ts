import { describe, it, expect } from 'vitest';
import { FLOOD_SCENARIO_IDS, formatScenarioTime, isFloodScenarioId } from './flood.js';

describe('formatScenarioTime', () => {
  it('formats the bulletin hour as Vietnam clock time', () => {
    expect(formatScenarioTime('2025-10-27T21:00:00+07:00', 24)).toBe('21:00 28/10/2025');
  });

  it('crosses midnight and month ends in Vietnam time, not UTC', () => {
    expect(formatScenarioTime('2025-10-27T21:00:00+07:00', 3)).toBe('00:00 28/10/2025');
    expect(formatScenarioTime('2025-10-27T21:00:00+07:00', 96)).toBe('21:00 31/10/2025');
    expect(formatScenarioTime('2025-10-27T14:00:00Z', 0)).toBe('21:00 27/10/2025');
  });
});

describe('isFloodScenarioId', () => {
  it('knows the four scenarios', () => {
    expect([...FLOOD_SCENARIO_IDS]).toEqual(['kttv-2025-10', 'preset-500', 'preset-1000', 'preset-1300']);
    expect(isFloodScenarioId('preset-500')).toBe(true);
    expect(isFloodScenarioId('../x')).toBe(false);
  });
});
