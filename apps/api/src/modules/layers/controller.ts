import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { featuresService } from './service';
import { listLayerMetadata } from '../../layers/registry';
import { featuresRepository, type FeatureRow } from './repository';
import { getUnitTree } from '../../authz/unitTree';
import { assertCan } from '../../authz/assert';
import { COUNTRY_UNIT } from '@webatlas/shared';
import { AuthError } from '../../errors';
import type { CurrentUser } from '../../types/fastify';

const KeyParams = z.object({ key: z.string() });
const KeyIdParams = z.object({ key: z.string(), id: z.string().uuid() });
const Source = z.object({
  document: z.string().trim().min(1, 'Thiếu tài liệu nguồn').max(500),
  provider: z.string().trim().min(1, 'Thiếu người cung cấp').max(200),
});
const FeatureBody = z.object({
  geometry: z.unknown().optional(),
  properties: z.record(z.unknown()).optional(),
  source: Source.optional(),
});
// Mã đơn vị hành chính là chuỗi số ngắn ('66', '66123'); giới hạn độ dài để một tham số
// rác bị từ chối ở biên chứ không lặng lẽ khớp không ra gì.
const FeatureQuery = z.object({
  province: z.string().regex(/^\d{1,6}$/, 'Mã tỉnh không hợp lệ').optional(),
  ward: z.string().regex(/^\d{1,8}$/, 'Mã xã/phường không hợp lệ').optional(),
});

// Write routes run app.authenticate first, so a missing user here is a wiring error; refuse
// rather than write as nobody.
function actorOf(req: FastifyRequest): CurrentUser {
  if (!req.currentUser) throw new AuthError();
  return req.currentUser;
}

function toFeature(row: FeatureRow) {
  return { type: 'Feature' as const, id: row.id, geometry: row.geometry, properties: row.properties };
}

export async function getLayers(_req: FastifyRequest, reply: FastifyReply) {
  reply.send({ layers: listLayerMetadata() });
}

export async function listFeatures(req: FastifyRequest, reply: FastifyReply) {
  const { key } = validate(KeyParams, req.params);
  const filter = validate(FeatureQuery, req.query);
  const rows = await featuresService(req.server.pg).list(key, filter);
  reply.send({ type: 'FeatureCollection', features: rows.map(toFeature) });
}

// Features nobody could place (no geometry) wait at the country level. Only someone who may
// update features at 'VN' AND publish there (submission.review: direct publish until P4) can
// assign them, so only they get the list. P4 relaxes this to feature.update alone.
export async function listUnassigned(req: FastifyRequest, reply: FastifyReply) {
  const tree = await getUnitTree(req.server.pg);
  const user = actorOf(req);
  assertCan(user, 'feature.update', COUNTRY_UNIT, tree);
  assertCan(user, 'submission.review', COUNTRY_UNIT, tree);
  const features = await featuresRepository(req.server.pg).listUnassigned();
  reply.send({ features });
}

export async function createFeature(req: FastifyRequest, reply: FastifyReply) {
  const { key } = validate(KeyParams, req.params);
  const body = validate(FeatureBody, req.body);
  const tree = await getUnitTree(req.server.pg);
  const { feature, warnings } = await featuresService(req.server.pg).create(key, body, actorOf(req), tree);
  reply.code(201).send({ feature: toFeature(feature), warnings });
}

export async function updateFeature(req: FastifyRequest, reply: FastifyReply) {
  const { key, id } = validate(KeyIdParams, req.params);
  const body = validate(FeatureBody, req.body);
  const tree = await getUnitTree(req.server.pg);
  const { feature, warnings } = await featuresService(req.server.pg).update(key, id, body, actorOf(req), tree);
  reply.send({ feature: toFeature(feature), warnings });
}

export async function deleteFeature(req: FastifyRequest, reply: FastifyReply) {
  const { key, id } = validate(KeyIdParams, req.params);
  const tree = await getUnitTree(req.server.pg);
  await featuresService(req.server.pg).remove(key, id, actorOf(req), tree);
  reply.code(204).send();
}
