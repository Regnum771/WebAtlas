import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthError } from '../../errors';
import { validate } from '../../lib/validate';
import type { CurrentUser } from '../../types/fastify';
import { mapsService } from './maps';
import { CreateMapBody, DeleteMapBody, MapIdParams, UpdateMapBody } from './schemas';

/*
 * Handlers for /api/workspace. Every map-scoped handler validates its params, then hands the
 * current user to a service that checks the user's role on the map itself (access.ts); no
 * handler decides access on its own.
 *
 * Layer routes (later tasks) are one route set for every layer kind: the handler reads the
 * layer's kind once, scoped to the map, and dispatches to the service for that kind.
 */

function userOf(req: FastifyRequest): CurrentUser {
  // app.authenticate runs first on every route here; this only narrows the type.
  if (!req.currentUser) throw new AuthError();
  return req.currentUser;
}

// --- Maps ---------------------------------------------------------------------------------

export async function listMaps(req: FastifyRequest, reply: FastifyReply) {
  const user = userOf(req);
  const maps = mapsService(req.server.pg);
  const [mine, sharedWithMe] = await Promise.all([maps.listMine(user), maps.listSharedWithMe(user)]);
  reply.send({ mine, sharedWithMe });
}

export async function createMap(req: FastifyRequest, reply: FastifyReply) {
  const body = validate(CreateMapBody, req.body);
  const map = await mapsService(req.server.pg).create(userOf(req), body);
  reply.code(201).send({ map });
}

export async function getMap(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  reply.send({ map: await mapsService(req.server.pg).get(userOf(req), mapId) });
}

export async function updateMap(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  const body = validate(UpdateMapBody, req.body);
  reply.send({ map: await mapsService(req.server.pg).update(userOf(req), mapId, body) });
}

export async function deleteMap(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  const body = validate(DeleteMapBody, req.body);
  await mapsService(req.server.pg).remove(userOf(req), mapId, body);
  reply.code(204).send();
}
