import type { FastifyReply, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../errors';
import { getDictionary, getFeatureType } from './service';

/** GET /api/dictionary: the whole dictionary with a strong ETag; a matching If-None-Match gets 304. */
export async function dictionary(req: FastifyRequest, reply: FastifyReply) {
  const body = await getDictionary(req.server.pg);
  const etag = `"${body.version}"`;
  reply.header('ETag', etag).header('Cache-Control', 'no-cache');
  if (req.headers['if-none-match'] === etag) return reply.code(304).send();
  return reply.send(body);
}

/** GET /api/dictionary/:layer: one feature type by key. */
export async function dictionaryLayer(req: FastifyRequest, reply: FastifyReply) {
  const { layer } = req.params as { layer: string };
  const featureType = await getFeatureType(req.server.pg, layer);
  if (!featureType) throw new NotFoundError(`Không có lớp "${layer}" trong từ điển dữ liệu.`);
  return reply.send(featureType);
}
