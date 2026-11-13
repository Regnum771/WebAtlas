import { formatScenarioTime, type FloodScenarioDetail } from '@webatlas/shared';
import { forecastPointRows } from '../../flood-scenario/model/levels';
import { runningTotals, type RainDay } from './rain';

const esc = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (v: number | null) => (v === null ? '' : String(Math.round(v * 100) / 100));
const row = (cells: unknown[]) => cells.map(esc).join(',');

/**
 * The forecast-point table, then every station's hourly level and bulletin forecast. UTF-8 BOM and
 * CRLF so Excel reads Vietnamese correctly (as analysis/model/csv.ts).
 */
export function forecastCsv(detail: FloodScenarioDetail): string {
  const time = (h: number) => formatScenarioTime(detail.startTime, h);
  const lines = [
    `﻿${row(['Kịch bản', detail.name])}`,
    row(['Phát hành', time(detail.bulletinHour)]),
    row(['Dữ liệu mẫu', 'có']),
    '',
    row(['Điểm dự báo', 'Mực nước lúc phát hành (m)', 'Đỉnh dự báo (m)', 'Thời điểm đỉnh', 'Cấp báo động']),
    ...forecastPointRows(detail).map((r) => row([
      r.station.name, num(r.bulletinLevel), num(r.forecastPeak),
      r.forecastPeakHour === null ? '' : time(r.forecastPeakHour), r.alarm ?? 'dưới BĐ1',
    ])),
    '',
    row(['Thời điểm', ...detail.stations.flatMap((s) => [`${s.name} mực nước (m)`, `${s.name} dự báo (m)`])]),
  ];
  const hours = detail.series[detail.stations[0]?.id]?.level.length ?? 0;
  for (let h = 0; h < hours; h++) {
    lines.push(row([time(h), ...detail.stations.flatMap((s) => {
      const series = detail.series[s.id];
      return [num(series?.level[h] ?? null), num(series?.forecast[h] ?? null)];
    })]));
  }
  return lines.join('\r\n');
}

/** Basin daily rain and its running total. */
export function rainCsv(days: RainDay[]): string {
  const totals = runningTotals(days);
  return [`﻿${row(['Ngày', 'Mưa ngày (mm)', 'Lũy kế (mm)'])}`, ...days.map((d, i) => row([d.date, num(d.mm), num(totals[i])]))].join('\r\n');
}

export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
