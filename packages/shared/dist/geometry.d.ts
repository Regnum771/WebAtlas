/**
 * GeoJSON geometry (EPSG:4326) as it crosses the wire between the API and the
 * browser: result shapes, analysis inputs. Hand-written validation, no Zod —
 * imported by the browser bundle.
 */
export type GeoJsonGeometry = {
    type: 'Point';
    coordinates: number[];
} | {
    type: 'MultiPoint';
    coordinates: number[][];
} | {
    type: 'LineString';
    coordinates: number[][];
} | {
    type: 'MultiLineString';
    coordinates: number[][][];
} | {
    type: 'Polygon';
    coordinates: number[][][];
} | {
    type: 'MultiPolygon';
    coordinates: number[][][][];
};
export declare function isGeoJsonGeometry(value: unknown): value is GeoJsonGeometry;
/** Every position of a geometry, flattened. */
export declare function positionsOf(g: GeoJsonGeometry): number[][];
export declare function countVertices(g: GeoJsonGeometry): number;
