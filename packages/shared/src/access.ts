/**
 * Access model: permissions are granted on an administrative unit and cover
 * that unit and everything below it (VN -> province -> ward).
 */
export const PERMISSIONS = [
  'feature.create',
  'feature.update',
  'feature.delete',
  'map.import',
  'submission.review',
  'users.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'feature.create': 'thêm đối tượng',
  'feature.update': 'sửa đối tượng',
  'feature.delete': 'xoá đối tượng',
  'map.import': 'nhập bản đồ',
  'submission.review': 'duyệt và xuất bản',
  'users.manage': 'quản lý người dùng',
};

export const COUNTRY_UNIT = 'VN';
export const UNIT_CODE_RE = /^(VN|\d{2}|\d{5})$/;

export interface Grant {
  permission: Permission;
  unit: string;
}

export interface UnitNode {
  code: string;
  level: 'country' | 'province' | 'ward';
  parent: string | null;
  name: string;
}

export type UnitTree = ReadonlyMap<string, UnitNode>;

export function buildUnitTree(nodes: UnitNode[]): UnitTree {
  return new Map(nodes.map((n) => [n.code, n]));
}

/** The unit itself, then its parents up to VN. Empty for an unknown code. */
export function ancestorsOf(tree: UnitTree, code: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let current: string | null = code;
  while (current !== null && !seen.has(current)) {
    const node = tree.get(current);
    if (!node) break;
    seen.add(current);
    out.push(current);
    current = node.parent;
  }
  return out;
}

export function can(
  grants: readonly Grant[],
  permission: Permission,
  unit: string,
  tree: UnitTree,
): boolean {
  const chain = new Set(ancestorsOf(tree, unit));
  if (chain.size === 0) return false;
  return grants.some((g) => g.permission === permission && chain.has(g.unit));
}

/**
 * "Can save directly": feature.update and submission.review both cover at least one common
 * unit of the tree (a grant on a unit covers its descendants). Until submissions exist (P4)
 * this is what lets a write publish at all. Admin is the caller's concern: admin always may.
 * The API (assistant tool offer) and the web (Biên tập, proposal dialog) share this rule.
 */
export function canSaveDirectly(grants: readonly Grant[], tree: UnitTree): boolean {
  for (const code of tree.keys()) {
    if (can(grants, 'feature.update', code, tree) && can(grants, 'submission.review', code, tree)) return true;
  }
  return false;
}

/** Distinct, sorted units on which the permission is granted directly. */
export function unitsFor(grants: readonly Grant[], permission: Permission): string[] {
  return [...new Set(grants.filter((g) => g.permission === permission).map((g) => g.unit))].sort();
}

/** True when `unit` is one of `scopeUnits` or lies below one of them. */
export function isWithin(unit: string, scopeUnits: readonly string[], tree: UnitTree): boolean {
  const chain = ancestorsOf(tree, unit);
  return scopeUnits.some((s) => chain.includes(s));
}

const OFFICER_PERMISSIONS: Permission[] = [
  'feature.create',
  'feature.update',
  'feature.delete',
  'map.import',
];

/** Interface presets for creating groups; not groups themselves. */
export const GROUP_TEMPLATES: ReadonlyArray<{
  id: 'bo' | 'tinh' | 'xa';
  name: string;
  level: UnitNode['level'];
  permissions: Permission[];
}> = [
  { id: 'bo', name: 'Cán bộ cấp Bộ', level: 'country', permissions: [...OFFICER_PERMISSIONS] },
  { id: 'tinh', name: 'Cán bộ cấp tỉnh', level: 'province', permissions: [...OFFICER_PERMISSIONS] },
  { id: 'xa', name: 'Cán bộ cấp xã', level: 'ward', permissions: [...OFFICER_PERMISSIONS] },
];
