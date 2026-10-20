import type { FastifyInstance } from 'fastify';
import { createMap, deleteMap, getMap, listMaps, updateMap } from './controller';

// Personal maps. Any signed-in user has a workspace; who sees or writes a given map is decided
// per map by the services (access.ts), not by a route guard.
export default async function workspaceRoutes(app: FastifyInstance) {
  const signedIn = { preHandler: [app.authenticate] };
  app.get('/maps', signedIn, listMaps);
  app.post('/maps', signedIn, createMap);
  app.get('/maps/:mapId', signedIn, getMap);
  app.patch('/maps/:mapId', signedIn, updateMap);
  app.delete('/maps/:mapId', signedIn, deleteMap);
}
