/**
 * Access model: permissions are granted on an administrative unit and cover
 * that unit and everything below it (VN -> province -> ward).
 */
export declare const PERMISSIONS: readonly ["feature.create", "feature.update", "feature.delete", "map.import", "submission.review", "users.manage"];
export type Permission = (typeof PERMISSIONS)[number];
export declare const PERMISSION_LABELS: Record<Permission, string>;
export declare const COUNTRY_UNIT = "VN";
export declare const UNIT_CODE_RE: RegExp;
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
export declare function buildUnitTree(nodes: UnitNode[]): UnitTree;
/** The unit itself, then its parents up to VN. Empty for an unknown code. */
export declare function ancestorsOf(tree: UnitTree, code: string): string[];
export declare function can(grants: readonly Grant[], permission: Permission, unit: string, tree: UnitTree): boolean;
/** Distinct, sorted units on which the permission is granted directly. */
export declare function unitsFor(grants: readonly Grant[], permission: Permission): string[];
/** True when `unit` is one of `scopeUnits` or lies below one of them. */
export declare function isWithin(unit: string, scopeUnits: readonly string[], tree: UnitTree): boolean;
/** Interface presets for creating groups; not groups themselves. */
export declare const GROUP_TEMPLATES: ReadonlyArray<{
    id: 'bo' | 'tinh' | 'xa';
    name: string;
    level: UnitNode['level'];
    permissions: Permission[];
}>;
