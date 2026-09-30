import { z } from 'zod';
import { countVertices, isGeoJsonGeometry, positionsOf, type GeoJsonGeometry } from '@webatlas/shared';
import { inVietnam } from '../../lib/geo';

/** The resulting ROI's vertex ceiling (area.ts explains why admin units are exempt). */
export const MAX_INPUT_VERTICES = 5000;

type GeometryType = GeoJsonGeometry['type'];

/**
 * A GeoJSON geometry of one of `types`, within MAX_INPUT_VERTICES, inside Vietnam.
 * Its own module so roi/schema.ts and analysis/schemas.ts can both use it without
 * importing each other.
 */
export function geometryInput(types: GeometryType[]) {
  return z.custom<GeoJsonGeometry>(
    (v) =>
      isGeoJsonGeometry(v) &&
      types.includes(v.type) &&
      countVertices(v) <= MAX_INPUT_VERTICES &&
      positionsOf(v).every(([lon, lat]) => inVietnam(lon, lat)),
    { message: `Hình không hợp lệ: cần ${types.join('/')}, tối đa ${MAX_INPUT_VERTICES} điểm, nằm trong Việt Nam` }
  );
}
