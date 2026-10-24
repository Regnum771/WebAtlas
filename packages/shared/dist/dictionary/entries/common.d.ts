import type { DictAttribute, DictValue } from '../types.js';
/** Date the code entries of Plan A take effect. */
export declare const VALID_FROM = "2026-10-24";
export declare function nameAttribute(definition: string): DictAttribute;
export declare function externalIdAttribute(definition?: string): DictAttribute;
export declare function managingUnitAttribute(): DictAttribute;
/** Open list: the codes are the Vietnamese words stored today (Ruling 1). */
export declare function riskLevelAttribute(definition: string): DictAttribute;
/** Listed values whose name equals the stored code, in the given order (Ruling 1). */
export declare function storedValues(codes: readonly string[]): DictValue[];
