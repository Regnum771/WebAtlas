import type { EditableLayerKey } from './index';

export type OgcGeometryType = 'Point' | 'MultiLineString' | 'MultiPolygon';

/**
 * Geometry types a data dictionary entry may name: the editable layers' types plus the
 * single-part lines a read-only layer stores (scenario.flood_road). Kept apart from
 * OgcGeometryType so the drawing and editing code that maps every editable type is unaffected.
 */
export type StoredGeometryType = OgcGeometryType | 'LineString';

/** Geometry type per editable layer — matches the water.* migration (INV-4). */
export const LAYER_GEOMETRY: Record<EditableLayerKey, OgcGeometryType> = {
  dams: 'Point',
  rivers: 'MultiLineString',
  lakes: 'MultiPolygon',
  stations: 'Point',
  flood_zones: 'MultiPolygon',
  drought_points: 'Point',
  saltwater_intrusion: 'Point',
  flood_generation: 'MultiPolygon',
};
