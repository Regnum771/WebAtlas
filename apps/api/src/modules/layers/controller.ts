import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { featuresService } from './service';
import { listLayerMetadata } from '../../layers/registry';
import type { FeatureRow } from './repository';

const KeyParams = z.object({ key: z.string() });
const KeyIdParams = z.object({ key: z.string(), id: z.string().uuid() });
const FeatureBody = z.object({ geometry: z.unknown().optional(), properties: z.record(z.unknown()).optional() });

function toFeature(row: FeatureRow) {
  return { type: 'Feature' as const, id: row.id, geometry: row.geometry, properties: row.properties };
}

export async function getLayers(_req: FastifyRequest, reply: FastifyReply) {
  reply.send({ layers: listLayerMetadata() });
}

export async function listFeatures(req: FastifyRequest, reply: FastifyReply) {
  const { key } = validate(KeyParams, req.params);
  const rows = await featuresService(req.server.pg).list(key);
  reply.send({ type: 'FeatureCollection', features: rows.map(toFeature) });
}

export async function createFeature(req: FastifyRequest, reply: FastifyReply) {
  const { key } = validate(KeyParams, req.params);
  const body = validate(FeatureBody, req.body);
  const row = await featuresService(req.server.pg).create(key, body, req.currentUser?.id);
  reply.code(201).send({ feature: toFeature(row) });
}

export async function updateFeature(req: FastifyRequest, reply: FastifyReply) {
  const { key, id } = validate(KeyIdParams, req.params);
  const body = validate(FeatureBody, req.body);
  const row = await featuresService(req.server.pg).update(key, id, body, req.currentUser?.id);
  reply.send({ feature: toFeature(row) });
}

export async function deleteFeature(req: FastifyRequest, reply: FastifyReply) {
  const { key, id } = validate(KeyIdParams, req.params);
  await featuresService(req.server.pg).remove(key, id, req.currentUser?.id);
  reply.code(204).send();
}
