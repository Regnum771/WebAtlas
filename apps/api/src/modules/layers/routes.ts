import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../../authz/assert';
import { getLayers, listFeatures, listUnassigned, createFeature, updateFeature, deleteFeature } from './controller';

export default async function layersRoutes(app: FastifyInstance) {
  // Any signed-in user may read features.
  const canRead = { preHandler: [app.authenticate] };
  // Writes: the route only asks that the user holds the operation's permission somewhere.
  // Whether the feature's managing unit lies within that jurisdiction (and the review right
  // a direct publish needs) is checked per object by featuresService, inside the edit session.
  const canDo = (permission: Parameters<typeof requirePermission>[0]) => ({
    preHandler: [app.authenticate, requirePermission(permission)],
  });
  app.get('/layers', getLayers); // public metadata (INV-2 catalog)
  // Static path, registered before the parametrised ones; `/layers/unassigned` has no
  // `/features` suffix, so it can never match `/layers/:key/features` anyway.
  app.get('/layers/unassigned', canDo('feature.update'), listUnassigned);
  app.get('/layers/:key/features', canRead, listFeatures);
  app.post('/layers/:key/features', canDo('feature.create'), createFeature);
  app.put('/layers/:key/features/:id', canDo('feature.update'), updateFeature);
  app.delete('/layers/:key/features/:id', canDo('feature.delete'), deleteFeature);
}
