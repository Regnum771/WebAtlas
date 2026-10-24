import type { DictAttribute, Dictionary } from './types.js';
export declare function attributeOf(dictionary: Dictionary, layer: string, name: string): DictAttribute | undefined;
export declare function labelFor(dictionary: Dictionary, layer: string, name: string): string;
export declare function valueName(attribute: DictAttribute, code: string): string;
/**
 * A number in the display unit, vi-VN grouped, at the attribute's precision, without the
 * unit symbol. Missing or non-numeric values give the dash.
 */
export declare function formatDisplayNumber(attribute: DictAttribute, stored: unknown): string;
export declare function formatValue(attribute: DictAttribute, stored: unknown): string;
/** Text for a form input: full precision in the display unit, comma decimal, no grouping, no symbol. */
export declare function toDisplayInput(attribute: DictAttribute, stored: unknown): string;
export declare function parseDisplay(attribute: DictAttribute, text: string): {
    ok: true;
    value: number;
} | {
    ok: false;
    message: string;
};
