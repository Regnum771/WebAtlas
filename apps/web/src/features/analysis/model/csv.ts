import type { AnalysisResult } from '@webatlas/shared';

const esc = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** UTF-8 BOM first so Excel reads Vietnamese correctly; CRLF for the same reason. */
export function resultToCsv(r: AnalysisResult): string {
  const lines = ['﻿Mục,Giá trị', ...Object.entries(r.summary).map(([k, v]) => `${esc(k)},${esc(v)}`)];
  if (r.rows && r.rows.length > 0) {
    lines.push('', 'Lớp,Mã đối tượng,Tên,Kinh độ,Vĩ độ,Khoảng cách (km)');
    for (const row of r.rows) {
      lines.push([row.layerKey, row.featureId, row.name, row.lon, row.lat, row.distanceKm].map(esc).join(','));
    }
  }
  if (r.profile && r.profile.length > 0) {
    lines.push('', 'Khoảng cách (m),Độ cao (m)');
    for (const p of r.profile) lines.push(`${p.distanceM},${p.elevationM ?? ''}`);
  }
  if (r.attribution) lines.push('', esc(r.attribution));
  return lines.join('\r\n');
}

export function downloadCsv(r: AnalysisResult, filename: string): void {
  const url = URL.createObjectURL(new Blob([resultToCsv(r)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
