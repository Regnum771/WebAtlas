import type { FastifyInstance } from 'fastify';
import { featureGeometry } from './controller';

export default async function geometryRoutes(app: FastifyInstance) {
  app.get('/features/:layerKey/:id/geometry', featureGeometry);
}
