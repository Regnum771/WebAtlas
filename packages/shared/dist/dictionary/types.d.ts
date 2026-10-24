import type { OgcGeometryType } from '../layer-geometry.js';
export type ValueType = 'text' | 'number' | 'date' | 'code';
export type AttributeSource = 'column' | 'extra' | 'band';
export type GeometryMeaning = 'exact' | 'approximate' | 'representativePoint';
export interface DictValue {
    code: string;
    name: string;
    definition?: string;
    order: number;
    retired?: boolean;
    colorHint?: string;
}
export interface DictAttribute {
    name: string;
    source: AttributeSource;
    valueType: ValueType;
    label: string;
    definition: string;
    storedUnit?: string;
    displayUnits?: string[];
    displayUnit?: string;
    precision?: number;
    cfStandardName?: string;
    codeList?: 'closed' | 'open';
    values?: DictValue[];
    nodata?: number;
    scale?: number;
    offset?: number;
    validFrom: string;
    validTo?: string;
}
export interface DictFeatureType {
    key: string;
    kind: 'vector' | 'raster';
    name: string;
    definition: string;
    /** `schema.table`; for rasters it is the raster table. */
    table?: string;
    crs: number;
    geometryType?: OgcGeometryType;
    geometryMeaning: GeometryMeaning;
    validFrom: string;
    validTo?: string;
    attributes: DictAttribute[];
}
export type Dictionary = Readonly<Record<string, DictFeatureType>>;
/** Columns that are not attributes: bookkeeping, geometry and raster plumbing are described elsewhere. */
export declare const BOOKKEEPING_COLUMNS: readonly string[];
