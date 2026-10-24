export type Dimension = 'length' | 'area' | 'volume' | 'flow' | 'power' | 'energy' | 'rate' | 'temperature' | 'concentration' | 'time' | 'dimensionless';
/** Base value = value * factor + offset. Base units: m, m2, m3, m3/s, W, J, mm/s, K, g/L, s, 1. */
export interface UnitDef {
    code: string;
    dimension: Dimension;
    factor: number;
    offset?: number;
    symbol: string;
    assumesWaterDensity?: boolean;
    approximate?: boolean;
}
export declare const UNITS: Readonly<Record<string, UnitDef>>;
export declare function unit(code: string): UnitDef;
export declare function sameDimension(a: string, b: string): boolean;
export declare function convert(value: number, from: string, to: string): number;
export declare function unitsOfDimension(dimension: Dimension): UnitDef[];
/** The other units of the same dimension, with 1 `code` expressed in each. Empty for offset units. */
export declare function commonConversions(code: string): {
    to: string;
    factor: number;
}[];
