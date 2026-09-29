import { z } from 'zod';
import { EDITABLE_LAYER_KEYS, REFERENCE_LAYER_KEYS, ROI_MAX_RADIUS_KM } from '@webatlas/shared';
import { geometryInput } from '../analysis/geometryInput';

const radiusKm = z
  .number()
  .gt(0, 'Bán kính phải lớn hơn 0')
  .max(ROI_MAX_RADIUS_KM, `Bán kính tối đa ${ROI_MAX_RADIUS_KM} km`);

/**
 * The wire form of @webatlas/shared's Roi (spec §9). `.strict()` on every member, so
 * an unknown field — notably a radius on an admin unit — is a 400, not silently dropped.
 */
export const RoiSchema = z
  .discriminatedUnion('source', [
    z.object({
      source: z.literal('drawn'),
      geometry: geometryInput(['Point', 'LineString', 'Polygon']),
      radiusKm: radiusKm.optional(),
    }).strict(),
    z.object({
      source: z.literal('feature'),
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string().uuid('Mã đối tượng không hợp lệ'),
      whole: z.literal(true).optional(),
      radiusKm: radiusKm.optional(),
    }).strict(),
    z.object({
      source: z.literal('reference'),
      referenceLayer: z.enum(REFERENCE_LAYER_KEYS),
      entityId: z.string().min(1, 'Thiếu mã thực thể'),
      radiusKm: radiusKm.optional(),
    }).strict(),
    z.object({
      source: z.literal('admin'),
      level: z.enum(['province', 'ward']),
      code: z.string().regex(/^\d{1,6}$/, 'Mã đơn vị hành chính không hợp lệ'),
    }).strict(),
  ])
  .refine((r) => r.source !== 'feature' || r.whole === undefined || r.layerKey === 'rivers', {
    message: '"Cả sông" (whole) chỉ áp dụng cho lớp sông',
    path: ['whole'],
  });
