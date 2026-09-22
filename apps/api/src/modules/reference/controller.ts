import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../errors';
import { validate } from '../../lib/validate';
import {
  REFERENCE_LAYER_KEYS,
  listReferenceMetadata,
  type ReferenceLayerKey,
} from '../../reference/registry';
import { getEntity, listEntities } from './repository';

const LayerParam = z.object({ layer: z.enum(REFERENCE_LAYER_KEYS) });
const EntityParam = LayerParam.extend({ entityId: z.string().min(1) });

const ListQuery = z.object({
  q: z.string().min(2, 'Từ khoá phải có ít nhất 2 ký tự').optional(),
  fclass: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** A Zod enum failure on the path means "no such layer", not "bad request". */
function layerOf(params: unknown): ReferenceLayerKey {
  const parsed = LayerParam.safeParse(params);
  if (!parsed.success) throw new NotFoundError('Không có lớp tham chiếu này');
  return parsed.data.layer;
}

export async function referenceLayers(_req: FastifyRequest, reply: FastifyReply) {
  reply.send({ layers: listReferenceMetadata() });
}

export async function referenceEntities(req: FastifyRequest, reply: FastifyReply) {
  const layer = layerOf(req.params);
  const { q, fclass, limit } = validate(ListQuery, req.query);
  const entities = await listEntities(req.server.pg, layer, {
    limit,
    ...(q ? { q } : {}),
    ...(fclass ? { fclass } : {}),
  });
  reply.send({ entities });
}

export async function referenceEntity(req: FastifyRequest, reply: FastifyReply) {
  const layer = layerOf(req.params);
  const parsed = EntityParam.safeParse(req.params);
  if (!parsed.success) throw new NotFoundError('Không tìm thấy thực thể tham chiếu');
  const entity = await getEntity(req.server.pg, layer, parsed.data.entityId);
  if (!entity) throw new NotFoundError('Không tìm thấy thực thể tham chiếu');
  reply.send({ entity });
}
