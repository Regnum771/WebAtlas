import { describe, it, expect } from 'vitest';
import type { AnalysisResult } from '@webatlas/shared';
import { resultToCsv } from './csv';

describe('resultToCsv', () => {
  it('starts with a BOM and writes summary, rows, profile and attribution', () => {
    const r: AnalysisResult = {
      op: 'nearest',
      summary: { 'Lớp': 'đập & hồ chứa', 'Gần nhất (km)': 1.5 },
      rows: [{ layerKey: 'dams', featureId: 'f1', name: 'Hồ "Ea Kao", Đắk Lắk', lon: 108.1, lat: 12.6, distanceKm: 1.5 }],
      profile: [{ distanceM: 0, elevationM: 470 }, { distanceM: 10, elevationM: null }],
      geometries: [],
      attribution: 'FABDEM',
    };
    const csv = resultToCsv(r);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Gần nhất (km),1.5');
    expect(csv).toContain('"Hồ ""Ea Kao"", Đắk Lắk"');
    expect(csv).toContain('10,');
    expect(csv.split('\r\n').at(-1)).toBe('FABDEM');
  });
});
