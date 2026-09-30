import { describe, it, expect } from 'vitest';
import type { ResolvedRoi } from '@webatlas/shared';
import { toolAvailability, ROI_TOOLS } from './toolAvailability';

const base = { label: 'x', display: { type: 'Point', coordinates: [108, 13] }, bbox: [108, 13, 108, 13], centroid: [108, 13] } as const;
const area = (areaKm2: number): ResolvedRoi => ({ ...base, kind: 'area', measure: { areaKm2 } } as unknown as ResolvedRoi);
const line = { ...base, kind: 'line', measure: { lengthKm: 10 } } as unknown as ResolvedRoi;
const point = { ...base, kind: 'point', measure: null } as unknown as ResolvedRoi;
const off = (reason: string) => ({ enabled: false, reason });
const ON = { enabled: true };

describe('toolAvailability — spec §8, cell by cell', () => {
  it('disables everything with no ROI', () => {
    for (const tool of ROI_TOOLS) expect(toolAvailability(tool, null)).toEqual(off('Chưa có vùng phân tích'));
  });
  it('Chọn trong vùng', () => {
    expect(toolAvailability('select_within', area(10))).toEqual(ON);
    expect(toolAvailability('select_within', line)).toEqual(off('Thêm bán kính để dùng cho đường này'));
    expect(toolAvailability('select_within', point)).toEqual(off('Thêm bán kính để dùng cho điểm này'));
  });
  it('Thống kê độ cao', () => {
    expect(toolAvailability('zonal_elevation', area(5000))).toEqual(ON);
    expect(toolAvailability('zonal_elevation', area(18086.4)))
      .toEqual(off('Vùng 18.086 km² vượt giới hạn 5.000 km² của thống kê độ cao'));
    expect(toolAvailability('zonal_elevation', line)).toEqual(off('Cần một vùng — thêm bán kính'));
    expect(toolAvailability('zonal_elevation', point)).toEqual(off('Cần một vùng — thêm bán kính'));
  });
  it('Trắc diện độ cao', () => {
    expect(toolAvailability('elevation_profile', line)).toEqual(ON);
    expect(toolAvailability('elevation_profile', area(10))).toEqual(off('Cần một đường, ví dụ một con sông'));
    expect(toolAvailability('elevation_profile', point)).toEqual(off('Cần một đường, ví dụ một con sông'));
  });
  it('Gần nhất works on every kind (from the centroid)', () => {
    for (const r of [area(10), line, point]) expect(toolAvailability('nearest', r)).toEqual(ON);
  });
});
