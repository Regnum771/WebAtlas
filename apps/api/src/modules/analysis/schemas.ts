import { z } from 'zod';
import {
  EDITABLE_LAYER_KEYS,
  countVertices,
  isGeoJsonGeometry,
  positionsOf,
  type GeoJsonGeometry,
} from '@webatlas/shared';
import { inVietnam } from '../../lib/geo';

export const MAX_INPUT_VERTICES = 5000;

type GeometryType = GeoJsonGeometry['type'];
const ALL_TYPES: GeometryType[] = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

function geometryInput(types: GeometryType[]) {
  return z.custom<GeoJsonGeometry>(
    (v) =>
      isGeoJsonGeometry(v) &&
      types.includes(v.type) &&
      countVertices(v) <= MAX_INPUT_VERTICES &&
      positionsOf(v).every(([lon, lat]) => inVietnam(lon, lat)),
    { message: `Hình không hợp lệ: cần ${types.join('/')}, tối đa ${MAX_INPUT_VERTICES} điểm, nằm trong Việt Nam` }
  );
}

export const FeatureRef = z.object({
  layerKey: z.enum(EDITABLE_LAYER_KEYS),
  featureId: z.string().uuid('Mã đối tượng không hợp lệ'),
});
export type FeatureRefInput = z.infer<typeof FeatureRef>;

const exactlyOne = (v: { geometry?: unknown; feature?: unknown }) =>
  (v.geometry === undefined) !== (v.feature === undefined);
const EXACTLY_ONE = 'Cần đúng một trong hai: geometry (hình vẽ) hoặc feature (đối tượng)';

const radiusKm = z.number().gt(0, 'Bán kính phải lớn hơn 0').max(100, 'Bán kính tối đa 100 km');

export const BufferInput = z
  .object({ geometry: geometryInput(ALL_TYPES).optional(), feature: FeatureRef.optional(), radiusKm })
  .refine(exactlyOne, EXACTLY_ONE);
export type BufferInput = z.infer<typeof BufferInput>;

export const SelectWithinInput = z
  .object({
    geometry: geometryInput(['Polygon', 'MultiPolygon']).optional(),
    feature: FeatureRef.optional(),
    bufferKm: radiusKm.optional(),
    layerKeys: z.array(z.enum(EDITABLE_LAYER_KEYS)).min(1).max(EDITABLE_LAYER_KEYS.length),
  })
  .refine(exactlyOne, EXACTLY_ONE);
export type SelectWithinInput = z.infer<typeof SelectWithinInput>;

export const NearestInput = z
  .object({
    lon: z.number(),
    lat: z.number(),
    layerKey: z.enum(EDITABLE_LAYER_KEYS),
    k: z.number().int().min(1).max(25).default(5),
  })
  .refine(({ lon, lat }) => inVietnam(lon, lat), 'Toạ độ ngoài phạm vi Việt Nam');
export type NearestInput = z.infer<typeof NearestInput>;

export const ProfileInput = z
  .object({
    geometry: geometryInput(['LineString', 'MultiLineString']).optional(),
    feature: FeatureRef.optional(),
    samples: z.number().int().min(2).max(200).default(100),
  })
  .refine(exactlyOne, EXACTLY_ONE);
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ZonalInput = z
  .object({ geometry: geometryInput(['Polygon', 'MultiPolygon']).optional(), feature: FeatureRef.optional() })
  .refine(exactlyOne, EXACTLY_ONE);
export type ZonalInput = z.infer<typeof ZonalInput>;
