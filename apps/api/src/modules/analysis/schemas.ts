import { z } from 'zod';
import { EDITABLE_LAYER_KEYS, type GeoJsonGeometry } from '@webatlas/shared';
import { inVietnam } from '../../lib/geo';
import { REFERENCE_LAYER_KEYS } from '../../reference/registry';
import { MAX_INPUT_VERTICES, geometryInput } from './geometryInput';

export { MAX_INPUT_VERTICES };

type GeometryType = GeoJsonGeometry['type'];
const ALL_TYPES: GeometryType[] = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

export const FeatureRef = z.object({
  layerKey: z.enum(EDITABLE_LAYER_KEYS),
  featureId: z.string().uuid('Mã đối tượng không hợp lệ'),
});
export type FeatureRefInput = z.infer<typeof FeatureRef>;

const radiusKm = z.number().gt(0, 'Bán kính phải lớn hơn 0').max(100, 'Bán kính tối đa 100 km');

/**
 * A dissolved basemap entity as an ROI (spec §4/§5). Lines and points need a
 * radius to become an area; `area.ts` enforces that, because whether a radius is
 * required depends on the entity's own geometry, not just its layer.
 */
export const ReferenceRef = z.object({
  referenceLayer: z.enum(REFERENCE_LAYER_KEYS),
  entityId: z.string().min(1, 'Thiếu mã thực thể'),
  radiusKm: radiusKm.optional(),
});
export type ReferenceRefInput = z.infer<typeof ReferenceRef>;

const exactlyOne = (v: { geometry?: unknown; feature?: unknown; reference?: unknown }) =>
  [v.geometry, v.feature, v.reference].filter((x) => x !== undefined).length === 1;
const EXACTLY_ONE =
  'Cần đúng một trong ba: geometry (hình vẽ), feature (đối tượng) hoặc reference (thực thể nền bản đồ)';

export const BufferInput = z
  .object({
    geometry: geometryInput(ALL_TYPES).optional(),
    feature: FeatureRef.optional(),
    reference: ReferenceRef.optional(),
    radiusKm,
  })
  .refine(exactlyOne, EXACTLY_ONE);
export type BufferInput = z.infer<typeof BufferInput>;

export const SelectWithinInput = z
  .object({
    geometry: geometryInput(['Polygon', 'MultiPolygon']).optional(),
    feature: FeatureRef.optional(),
    reference: ReferenceRef.optional(),
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
    reference: ReferenceRef.optional(),
    samples: z.number().int().min(2).max(200).default(100),
  })
  .refine(exactlyOne, EXACTLY_ONE);
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ZonalInput = z
  .object({
    geometry: geometryInput(['Polygon', 'MultiPolygon']).optional(),
    feature: FeatureRef.optional(),
    reference: ReferenceRef.optional(),
  })
  .refine(exactlyOne, EXACTLY_ONE);
export type ZonalInput = z.infer<typeof ZonalInput>;
