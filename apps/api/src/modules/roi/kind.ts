import type { ResolvedRoi, Roi } from '@webatlas/shared';
import { ValidationError } from '../../errors';

const NOUN: Record<ResolvedRoi['kind'], string> = { area: 'vùng', line: 'đường', point: 'điểm' };

/**
 * An area tool (Chọn trong vùng, Thống kê độ cao) refuses a line or a point and names
 * the fix. The browser disables these tools already (§8); this is the server's own
 * check, so a client that ignores availability still gets a clear 400 (§10).
 */
export function requireArea(resolved: ResolvedRoi, toolLabel: string): void {
  if (resolved.kind !== 'area') {
    throw new ValidationError(`${toolLabel} cần một vùng; hãy thêm bán kính cho ${NOUN[resolved.kind]} này.`);
  }
}

/** Trắc diện độ cao takes a line; if a radius is what made it an area, say to remove it. */
export function requireLine(resolved: ResolvedRoi, roi: Roi): void {
  if (resolved.kind === 'line') return;
  const hasRadius = roi.source !== 'admin' && roi.radiusKm !== undefined;
  throw new ValidationError(
    'Trắc diện độ cao cần một tuyến đường; vùng phân tích này không phải là một tuyến đường' +
      (hasRadius ? ' — hãy bỏ bán kính.' : ', ví dụ hãy chọn một con sông.')
  );
}
