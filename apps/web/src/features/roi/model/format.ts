import type { RoiKind, RoiMeasure } from '@webatlas/shared';

const nf = (maxDigits: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: maxDigits });

/** Two decimals below 10, none above: "3,14 km²", "1.204 km²", "212 km". */
export function formatMeasure(measure: RoiMeasure): string | null {
  if (!measure) return null;
  if ('areaKm2' in measure) return `${nf(measure.areaKm2 < 10 ? 2 : 0).format(measure.areaKm2)} km²`;
  return `${nf(measure.lengthKm < 10 ? 2 : 0).format(measure.lengthKm)} km`;
}

/** A whole km² figure for reasons: "18.086". */
export function formatKm2(areaKm2: number): string {
  return nf(0).format(Math.round(areaKm2));
}

export const KIND_LABELS: Record<RoiKind, string> = { area: 'vùng', line: 'đường', point: 'điểm' };
