import type { EditableLayerKey } from './index';
export type OgcGeometryType = 'Point' | 'MultiLineString' | 'MultiPolygon';
/** Geometry type per editable layer — matches the water.* migration (INV-4). */
export declare const LAYER_GEOMETRY: Record<EditableLayerKey, OgcGeometryType>;
