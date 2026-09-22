import type { FastifyInstance } from 'fastify';
import { referenceEntities, referenceEntity, referenceLayers } from './controller';

/** Công khai như /api/search và /api/admin-units: nền bản đồ không phải dữ liệu nhạy cảm. */
export default async function referenceRoutes(app: FastifyInstance) {
  app.get('/reference/layers', referenceLayers);
  app.get('/reference/:layer/entities', referenceEntities);
  app.get('/reference/:layer/entities/:entityId', referenceEntity);
}
