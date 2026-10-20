import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthError, NotFoundError, ValidationError } from '../../errors';
import { validate } from '../../lib/validate';
import type { CurrentUser } from '../../types/fastify';
import { assertCanRead } from './access';
import { freeLayersService, LAYER_NOT_FOUND } from './freeLayers';
import { mapsService, type LayerKind } from './maps';
import {
  AddFeatureBody, AddFreeLayerBody, CreateMapBody, DeleteMapBody, FeatureParams, FeaturesQuery, LayerParams,
  MapIdParams, RemoveBody, UpdateFeatureBody, UpdateLayerBody, UpdateMapBody,
} from './schemas';

/*
 * Handlers for /api/workspace. Every map-scoped handler validates its params, then hands the
 * current user to a service that checks the user's role on the map itself (access.ts); no
 * handler decides access on its own.
 *
 * Layer routes are one route set for every layer kind: the handler reads the
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

// --- Layers and features ------------------------------------------------------------------

const UNSUPPORTED_KIND = 'Loại lớp này chưa hỗ trợ thao tác này.';

/**
 * The single dispatch point for layer routes: read the layer's kind once, scoped to the map.
 * Access is checked first, so a stranger gets the map's 404 before any layer lookup happens and
 * cannot tell which layers exist. Task 4 adds the 'edit_copy' branch at each call site.
 */
async function layerKindOf(req: FastifyRequest, mapId: string, layerId: string): Promise<LayerKind> {
  const pg = req.server.pg;
  await assertCanRead(pg, mapId, userOf(req));
  const { rows } = await pg.query<{ kind: LayerKind }>(
    `SELECT kind FROM workspace.map_layers WHERE id = $1 AND map_id = $2`, [layerId, mapId]
  );
  if (!rows[0]) throw new NotFoundError(LAYER_NOT_FOUND);
  return rows[0].kind;
}

function unsupported(): never {
  throw new ValidationError(UNSUPPORTED_KIND);
}

export async function addLayer(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  const kind = (req.body as { kind?: unknown } | null | undefined)?.kind;
  if (kind === undefined) validate(AddFreeLayerBody, req.body); // throws: kind is required
  if (kind !== 'free') unsupported();
  const body = validate(AddFreeLayerBody, req.body);
  const out = await freeLayersService(req.server.pg).addLayer(userOf(req), mapId, body);
  reply.code(201).send(out);
}

export async function updateLayer(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  const body = validate(UpdateLayerBody, req.body);
  if ((await layerKindOf(req, mapId, layerId)) !== 'free') unsupported();
  reply.send(await freeLayersService(req.server.pg).updateLayer(userOf(req), mapId, layerId, body));
}

export async function removeLayer(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  const body = validate(RemoveBody, req.body);
  if ((await layerKindOf(req, mapId, layerId)) !== 'free') unsupported();
  reply.send(await freeLayersService(req.server.pg).removeLayer(userOf(req), mapId, layerId, body));
}

export async function listFeatures(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  const query = validate(FeaturesQuery, req.query);
  if ((await layerKindOf(req, mapId, layerId)) !== 'free') unsupported();
  reply.send(await freeLayersService(req.server.pg).features(userOf(req), mapId, layerId, query));
}

export async function addFeature(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  const body = validate(AddFeatureBody, req.body);
  if ((await layerKindOf(req, mapId, layerId)) !== 'free') unsupported();
  reply.code(201).send(await freeLayersService(req.server.pg).addFeature(userOf(req), mapId, layerId, body));
}

export async function updateFeature(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId, featureId } = validate(FeatureParams, req.params);
  const body = validate(UpdateFeatureBody, req.body);
  if ((await layerKindOf(req, mapId, layerId)) !== 'free') unsupported();
  reply.send(await freeLayersService(req.server.pg).updateFeature(userOf(req), mapId, layerId, featureId, body));
}

export async function removeFeature(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId, featureId } = validate(FeatureParams, req.params);
  const body = validate(RemoveBody, req.body);
  if ((await layerKindOf(req, mapId, layerId)) !== 'free') unsupported();
  reply.send(await freeLayersService(req.server.pg).removeFeature(userOf(req), mapId, layerId, featureId, body));
}
