import { PERMISSIONS, unitsFor, type Grant, type Permission, type UnitTree } from '@webatlas/shared';

const SHORT_LABELS: Record<Permission, string> = {
  'feature.create': 'thêm',
  'feature.update': 'sửa',
  'feature.delete': 'xoá',
  'map.import': 'nhập',
  'submission.review': 'duyệt',
  'users.manage': 'quản lý người dùng',
};

/**
 * One line per distinct set of units, permissions in PERMISSIONS order,
 * e.g. 'Thêm, sửa, xoá, nhập: Đà Nẵng'. No grants reads 'Chỉ xem'.
 */
export function jurisdictionSummary(grants: readonly Grant[], tree: UnitTree | null): string[] {
  const byUnits = new Map<string, { units: string[]; permissions: Permission[] }>();
  for (const p of PERMISSIONS) {
    const units = unitsFor(grants, p);
    if (units.length === 0) continue;
    const key = units.join('|');
    const entry = byUnits.get(key) ?? { units, permissions: [] };
    entry.permissions.push(p);
    byUnits.set(key, entry);
  }
  if (byUnits.size === 0) return ['Chỉ xem'];
  const name = (code: string) => tree?.get(code)?.name ?? code;
  return [...byUnits.values()].map(({ units, permissions }) => {
    const labels = permissions.map((p) => SHORT_LABELS[p]).join(', ');
    return `${labels.charAt(0).toLocaleUpperCase('vi')}${labels.slice(1)}: ${units.map(name).join(', ')}`;
  });
}
