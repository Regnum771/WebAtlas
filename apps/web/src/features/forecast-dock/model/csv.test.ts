import { describe, expect, it } from 'vitest';
import type { FloodScenarioDetail } from '@webatlas/shared';
import { forecastCsv, rainCsv } from './csv';

const detail = {
  id: 'kttv-2025-10', name: 'Bản tin "KTTV"', startTime: '2025-10-25T17:00:00Z', hours: 2, bulletinHour: 1,
  stations: [{ id: 'cau-lau', name: 'Câu Lâu', river: 'Thu Bồn', bd1: 2, bd2: 3, bd3: 4, recordM: null, recordYear: null, derived: false }],
  series: { 'cau-lau': { level: [1, 2.5, 3.256], forecast: [null, null, 4.1] } },
} as unknown as FloodScenarioDetail;

describe('forecastCsv', () => {
  it('starts with a BOM, uses CRLF, and quotes what needs quoting', () => {
    const csv = forecastCsv(detail);
    expect(csv.startsWith('﻿Kịch bản,"Bản tin ""KTTV"""')).toBe(true);
    expect(csv).toContain('\r\n');
  });

  it('holds the forecast-point table and every hour of every station', () => {
    const lines = forecastCsv(detail).split('\r\n');
    expect(lines).toContain('Câu Lâu,2.5,4.1,02:00 26/10/2025,BĐ3');
    expect(lines).toContain('Thời điểm,Câu Lâu mực nước (m),Câu Lâu dự báo (m)');
    expect(lines.slice(-3)).toEqual(['00:00 26/10/2025,1,', '01:00 26/10/2025,2.5,', '02:00 26/10/2025,3.26,4.1']);
  });
});

describe('rainCsv', () => {
  it('lists each day with its running total', () => {
    expect(rainCsv([{ date: '2025-10-26', mm: 10 }, { date: '2025-10-27', mm: 5.5 }]).split('\r\n'))
      .toEqual(['﻿Ngày,Mưa ngày (mm),Lũy kế (mm)', '2025-10-26,10,10', '2025-10-27,5.5,15.5']);
  });
});
