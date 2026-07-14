import type { FastifyInstance } from 'fastify';
import { authorize } from '../../hooks/authorization';
import { getLayers, listFeatures, createFeature, updateFeature, deleteFeature } from './controller';

export default async function layersRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [app.authenticate, authorize('admin')] };
  app.get('/layers', getLayers); // public metadata (INV-2 catalog)
  app.get('/layers/:key/features', adminOnly, listFeatures);
  app.post('/layers/:key/features', adminOnly, createFeature);
  app.put('/layers/:key/features/:id', adminOnly, updateFeature);
  app.delete('/layers/:key/features/:id', adminOnly, deleteFeature);
}
