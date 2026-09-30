import { describe, it, expect } from 'vitest';
import { formatKm2, formatMeasure, KIND_LABELS } from './format';

describe('formatMeasure', () => {
  it('writes areas and lengths the Vietnamese way', () => {
    expect(formatMeasure({ areaKm2: 1204.3 })).toBe('1.204 km²');
    expect(formatMeasure({ lengthKm: 212.4 })).toBe('212 km');
    expect(formatMeasure({ areaKm2: 3.14159 })).toBe('3,14 km²');
    expect(formatMeasure(null)).toBeNull();
  });
  it('formats a bare km² figure for reasons', () => {
    expect(formatKm2(18086.4)).toBe('18.086');
  });
  it('names the kinds', () => {
    expect(KIND_LABELS).toEqual({ area: 'vùng', line: 'đường', point: 'điểm' });
  });
});
