import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { listProvinces, listWards } from './repository';

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
