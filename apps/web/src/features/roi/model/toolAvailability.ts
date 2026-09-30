import type { ResolvedRoi } from '@webatlas/shared';
import { formatKm2 } from './format';

export type RoiTool = 'select_within' | 'zonal_elevation' | 'elevation_profile' | 'nearest';
export const ROI_TOOLS: readonly RoiTool[] = ['select_within', 'zonal_elevation', 'elevation_profile', 'nearest'];

/** Mirrors apps/api/src/modules/analysis/ops/zonalElevation.ts's ceiling (spec C-3). */
export const MAX_ZONAL_AREA_KM2 = 5000;

export type Availability = { enabled: true } | { enabled: false; reason: string };

const ON: Availability = { enabled: true };
const off = (reason: string): Availability => ({ enabled: false, reason });

/**
 * Spec §8's availability table as one pure function (FR-7). Every disabled reason names
 * what would enable the tool (U-10).
 */
export function toolAvailability(tool: RoiTool, roi: ResolvedRoi | null): Availability {
  if (!roi) return off('Chưa có vùng phân tích');
  switch (tool) {
    case 'select_within':
      return roi.kind === 'area' ? ON : off(`Thêm bán kính để dùng cho ${roi.kind === 'line' ? 'đường' : 'điểm'} này`);
    case 'zonal_elevation': {
      if (roi.kind !== 'area') return off('Cần một vùng — thêm bán kính');
      const areaKm2 = (roi.measure as { areaKm2: number }).areaKm2;
      return areaKm2 > MAX_ZONAL_AREA_KM2
        ? off(`Vùng ${formatKm2(areaKm2)} km² vượt giới hạn ${formatKm2(MAX_ZONAL_AREA_KM2)} km² của thống kê độ cao`)
        : ON;
    }
    case 'elevation_profile':
      return roi.kind === 'line' ? ON : off('Cần một đường, ví dụ một con sông');
    case 'nearest':
      return ON;
  }
}
