import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { listProvinces, listWards, suggestManagingUnit } from './repository';
import { getUnitTree } from '../../authz/unitTree';
import { assertGeoJsonGeometry, assertValidGeoJsonInPg } from '../layers/geometry';

const Query = z
  .object({
    level: z.enum(['province', 'ward']),
    province: z.string().regex(/^\d{1,6}$/, 'Mã tỉnh không hợp lệ').optional(),
  })
  // 616 xã là quá nhiều để trả về khi không ai hỏi; buộc phải khoanh theo tỉnh.
  .refine((q) => q.level === 'province' || q.province !== undefined, {
    message: 'Liệt kê xã/phường phải kèm mã tỉnh',
  });

export async function adminUnits(req: FastifyRequest, reply: FastifyReply) {
  const q = validate(Query, req.query);
  const units = q.level === 'province'
    ? await listProvinces(req.server.pg)
    : await listWards(req.server.pg, q.province!);
  reply.send({ units });
}

const SuggestBody = z.object({
  geometry: z.unknown().refine((g) => g !== undefined && g !== null, { message: 'Thiếu hình học' }),
});

/** POST /api/admin-units/suggest: the managing unit the initial-assignment rule gives a geometry. */
export async function suggestUnit(req: FastifyRequest, reply: FastifyReply) {
  const { geometry } = validate(SuggestBody, req.body);
  const geometryJson = assertGeoJsonGeometry(geometry);
  await assertValidGeoJsonInPg(req.server.pg, geometryJson);
  reply.send({ unit: await suggestManagingUnit(req.server.pg, geometryJson) });
}

/** GET /api/admin-units/tree: every unit (VN, provinces, wards) with its parent. */
export async function unitTree(req: FastifyRequest, reply: FastifyReply) {
  const tree = await getUnitTree(req.server.pg);
  reply.send({ units: [...tree.values()] });
}
