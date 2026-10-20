import type { FastifyInstance } from 'fastify';
import {
  addFeature, addLayer, addShare, copyMap, createMap, deleteMap, getMap, listFeatures, listMaps, listShares,
  listShareTargets, removeFeature, removeLayer, removeShare, updateFeature, updateLayer, updateMap,
} from './controller';

// Personal maps. Any signed-in user has a workspace; who sees or writes a given map is decided
// per map by the services (access.ts), not by a route guard.
export default async function workspaceRoutes(app: FastifyInstance) {
  const signedIn = { preHandler: [app.authenticate] };
  app.get('/maps', signedIn, listMaps);
  app.post('/maps', signedIn, createMap);
  app.get('/maps/:mapId', signedIn, getMap);
  app.patch('/maps/:mapId', signedIn, updateMap);
  app.delete('/maps/:mapId', signedIn, deleteMap);
  app.post('/maps/:mapId/copy', signedIn, copyMap);

  // Shares are managed by the map's owner only; anyone signed in may look up share targets.
  app.get('/maps/:mapId/shares', signedIn, listShares);
  app.post('/maps/:mapId/shares', signedIn, addShare);
  app.delete('/maps/:mapId/shares/:shareId', signedIn, removeShare);
  app.get('/share-targets', signedIn, listShareTargets);

  // One route set for every layer kind; the controller dispatches on the layer's kind.
  app.post('/maps/:mapId/layers', signedIn, addLayer);
  app.patch('/maps/:mapId/layers/:layerId', signedIn, updateLayer);
  app.delete('/maps/:mapId/layers/:layerId', signedIn, removeLayer);
  app.get('/maps/:mapId/layers/:layerId/features', signedIn, listFeatures);
  app.post('/maps/:mapId/layers/:layerId/features', signedIn, addFeature);
  app.put('/maps/:mapId/layers/:layerId/features/:featureId', signedIn, updateFeature);
  app.delete('/maps/:mapId/layers/:layerId/features/:featureId', signedIn, removeFeature);
}
