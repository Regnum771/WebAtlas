import type { FastifyInstance } from 'fastify';
import { authorize } from '../../hooks/authorization';
import { CAN_READ_FEATURES, CAN_WRITE_FEATURES } from '../../hooks/capabilities';
import { getLayers, listFeatures, createFeature, updateFeature, deleteFeature } from './controller';

export default async function layersRoutes(app: FastifyInstance) {
  const canRead = { preHandler: [app.authenticate, authorize(...CAN_READ_FEATURES)] };
  const canWrite = { preHandler: [app.authenticate, authorize(...CAN_WRITE_FEATURES)] };
  app.get('/layers', getLayers); // public metadata (INV-2 catalog)
  app.get('/layers/:key/features', canRead, listFeatures);
  app.post('/layers/:key/features', canWrite, createFeature);
  app.put('/layers/:key/features/:id', canWrite, updateFeature);
  app.delete('/layers/:key/features/:id', canWrite, deleteFeature);
}
