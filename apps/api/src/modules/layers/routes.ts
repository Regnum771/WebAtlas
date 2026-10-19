import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../authz/assert';
import { getLayers, listFeatures, createFeature, updateFeature, deleteFeature } from './controller';

export default async function layersRoutes(app: FastifyInstance) {
  // Any signed-in user may read features.
  const canRead = { preHandler: [app.authenticate] };
  // Admin only for now; per-operation requirePermission replaces this (P1 Task 6).
  const canWrite = { preHandler: [app.authenticate, requireAdmin()] };
  app.get('/layers', getLayers); // public metadata (INV-2 catalog)
  app.get('/layers/:key/features', canRead, listFeatures);
  app.post('/layers/:key/features', canWrite, createFeature);
  app.put('/layers/:key/features/:id', canWrite, updateFeature);
  app.delete('/layers/:key/features/:id', canWrite, deleteFeature);
}
