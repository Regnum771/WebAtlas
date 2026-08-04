import type { EditableLayerKey } from './index';
export type FilterFieldType = 'enum' | 'number' | 'date' | 'text';
export interface FilterField {
    /** ISO/INSPIRE property name as stored on the in-memory feature. */
    iso: string;
    /** Vietnamese UI label. */
    label: string;
    type: FilterFieldType;
    /** For 'enum' — the allowed (canonical) values. */
    enumValues?: string[];
    /**
     * For 'number' — a unit divisor. The feature stores the raw value (e.g. metres);
     * the user enters, and comparisons run in, `raw / scale` (e.g. km with scale=1000).
     */
    scale?: number;
}
export declare const LAYER_FILTER_FIELDS: Record<EditableLayerKey, FilterField[]>;
