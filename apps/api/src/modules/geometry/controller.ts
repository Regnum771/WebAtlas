import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import { validate } from '../../lib/validate';
import { NotFoundError } from '../../errors';
import { resolveFeature } from '../assistant/tools/data/helpers';

const Params = z.object({
  layerKey: z.enum(EDITABLE_LAYER_KEYS),
  id: z.string().uuid('Mã đối tượng không hợp lệ'),
});

/**
 * GET /api/features/:layerKey/:id/geometry — simplified shape for highlighting a
 * search hit. Public like /api/search: the same data is already public over WFS.
 */
export async function featureGeometry(req: FastifyRequest, reply: FastifyReply) {
  const { layerKey, id } = validate(Params, req.params);
  const feature = await resolveFeature(req.server.pg, layerKey, id);
  if (!feature) throw new NotFoundError('Không tìm thấy đối tượng');
  reply.send({ layerKey, featureId: feature.featureId, name: feature.name, geometry: feature.geometry });
}
