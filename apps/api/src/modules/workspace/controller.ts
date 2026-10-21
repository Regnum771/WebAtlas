import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthError, NotFoundError, ValidationError } from '../../errors';
import { validate } from '../../lib/validate';
import type { CurrentUser } from '../../types/fastify';
import { assertCanRead } from './access';
import { editCopiesService } from './editCopies';
import { freeLayersService, LAYER_NOT_FOUND } from './freeLayers';
import { jobsService } from './jobs';
import { mapsService, type LayerKind } from './maps';
import {
  AddEditCopyLayerBody, AddFeatureBody, AddFreeLayerBody, AddShareBody, CreateMapBody, DeleteMapBody,
  EditCopyFeatureParams, EditCopyFeaturesQuery, ExportBody, ExportPreviewQuery, FeatureParams, FeaturesQuery, FileIdParams,
  ImportBody, JobIdParams, JobsQuery, LayerParams, MapIdParams, RemoveBody, ShareParams, ShareTargetsQuery,
  UpdateFeatureBody, UpdateLayerBody, UpdateMapBody,
} from './schemas';
import { adminSummary as adminSummaryQuery } from './cleanup';
import { rastersService, sendRaster } from './rasters';
import { sharingService } from './sharing';
import { FILE_NOT_FOUND, uploadsService } from './uploads';

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

export async function copyMap(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  const map = await sharingService(req.server.pg).copy(userOf(req), mapId);
  reply.code(201).send({ map });
}

// --- Sharing ------------------------------------------------------------------------------

export async function listShares(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  reply.send({ shares: await sharingService(req.server.pg).list(userOf(req), mapId) });
}

/** 201 for a new share; 200 with the existing one when the target already had it. */
export async function addShare(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  const body = validate(AddShareBody, req.body);
  const { share, created } = await sharingService(req.server.pg).add(userOf(req), mapId, body);
  reply.code(created ? 201 : 200).send({ share });
}

export async function removeShare(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, shareId } = validate(ShareParams, req.params);
  await sharingService(req.server.pg).remove(userOf(req), mapId, shareId);
  reply.code(204).send();
}

export async function listShareTargets(req: FastifyRequest, reply: FastifyReply) {
  const { q } = validate(ShareTargetsQuery, req.query);
  reply.send(await sharingService(req.server.pg).targets(userOf(req), q));
}

// --- Layers and features ------------------------------------------------------------------

const UNSUPPORTED_KIND = 'Loại lớp này chưa hỗ trợ thao tác này.';

/**
 * The single dispatch point for layer routes: read the layer's kind once, scoped to the map.
 * Access is checked first, so a stranger gets the map's 404 before any layer lookup happens and
 * cannot tell which layers exist. 'free' goes to freeLayersService, 'edit_copy' to
 * editCopiesService; 'raster' has its COG (getRaster) and a layer PATCH (rastersService) but no
 * features and, until Task 9, no DELETE; the other kinds are reserved and refused.
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

/** The service for a layer kind that supports layer and feature routes; refuses the others. */
function serviceFor(req: FastifyRequest, kind: LayerKind) {
  if (kind === 'free') return freeLayersService(req.server.pg);
  if (kind === 'edit_copy') return editCopiesService(req.server.pg);
  return unsupported();
}

export async function addLayer(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  const kind = (req.body as { kind?: unknown } | null | undefined)?.kind;
  if (kind === undefined) validate(AddFreeLayerBody, req.body); // throws: kind is required
  if (kind === 'free') {
    const body = validate(AddFreeLayerBody, req.body);
    reply.code(201).send(await freeLayersService(req.server.pg).addLayer(userOf(req), mapId, body));
  } else if (kind === 'edit_copy') {
    const body = validate(AddEditCopyLayerBody, req.body);
    reply.code(201).send(await editCopiesService(req.server.pg).addLayer(userOf(req), mapId, body));
  } else {
    unsupported();
  }
}

export async function updateLayer(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  const body = validate(UpdateLayerBody, req.body);
  const kind = await layerKindOf(req, mapId, layerId);
  // A raster layer has no features, but its row (title, style, position) is edited like any other.
  const service = kind === 'raster' ? rastersService(req.server.pg) : serviceFor(req, kind);
  reply.send(await service.updateLayer(userOf(req), mapId, layerId, body));
}

export async function removeLayer(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  const body = validate(RemoveBody, req.body);
  const service = serviceFor(req, await layerKindOf(req, mapId, layerId));
  reply.send(await service.removeLayer(userOf(req), mapId, layerId, body));
}

export async function listFeatures(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  const kind = await layerKindOf(req, mapId, layerId);
  if (kind === 'edit_copy') {
    // Validated after the kind is known: only an edit copy requires a bbox.
    const query = validate(EditCopyFeaturesQuery, req.query);
    reply.send(await editCopiesService(req.server.pg).features(userOf(req), mapId, layerId, query));
    return;
  }
  if (kind !== 'free') unsupported();
  const query = validate(FeaturesQuery, req.query);
  reply.send(await freeLayersService(req.server.pg).features(userOf(req), mapId, layerId, query));
}

/** A raster layer's COG, by byte range. Only raster layers have one; their feature routes stay refused. */
export async function getRaster(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  if ((await layerKindOf(req, mapId, layerId)) !== 'raster') unsupported();
  return sendRaster(req, reply, await rastersService(req.server.pg).cog(userOf(req), mapId, layerId));
}

export async function addFeature(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  const body = validate(AddFeatureBody, req.body);
  const service = serviceFor(req, await layerKindOf(req, mapId, layerId));
  reply.code(201).send(await service.addFeature(userOf(req), mapId, layerId, body));
}

/** The feature id in the route, in the shape the layer's kind uses for its features. */
function featureIdOf(req: FastifyRequest, kind: LayerKind): string {
  return validate(kind === 'edit_copy' ? EditCopyFeatureParams : FeatureParams, req.params).featureId;
}

export async function updateFeature(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  const body = validate(UpdateFeatureBody, req.body);
  const kind = await layerKindOf(req, mapId, layerId);
  const service = serviceFor(req, kind);
  reply.send(await service.updateFeature(userOf(req), mapId, layerId, featureIdOf(req, kind), body));
}

export async function removeFeature(req: FastifyRequest, reply: FastifyReply) {
  const { mapId, layerId } = validate(LayerParams, req.params);
  const body = validate(RemoveBody, req.body);
  const kind = await layerKindOf(req, mapId, layerId);
  const service = serviceFor(req, kind);
  reply.send(await service.removeFeature(userOf(req), mapId, layerId, featureIdOf(req, kind), body));
}

// --- Uploads ------------------------------------------------------------------------------

/** One multipart field, `file`. Multipart is registered for the workspace routes only (server.ts). */
export async function createUpload(req: FastifyRequest, reply: FastifyReply) {
  const user = userOf(req);
  if (!req.isMultipart()) throw new ValidationError();
  const part = await req.file();
  if (!part) throw new ValidationError();
  if (part.fieldname !== 'file') {
    part.file.resume(); // let the request body drain
    throw new ValidationError();
  }
  const { upload } = await uploadsService(req.server.pg).upload(user, {
    filename: part.filename, mimetype: part.mimetype, file: part.file,
  });
  reply.code(201).send({ upload });
}

export async function listUploads(req: FastifyRequest, reply: FastifyReply) {
  const user = userOf(req);
  const uploads = uploadsService(req.server.pg);
  const [list, usage] = await Promise.all([uploads.list(user), uploads.usage(user)]);
  reply.send({ uploads: list, ...usage });
}

/** RFC 5987 value: encodeURIComponent leaves ' ( ) * as they are, which attr-char does not allow. */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Send a stored file as a download (an upload's original, an export). A row whose file is gone
 * reads as a missing file, not a server error.
 */
async function sendDownload(reply: FastifyReply, file: { absPath: string; downloadName: string; contentType: string }) {
  let size: number;
  try {
    size = (await stat(file.absPath)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(FILE_NOT_FOUND);
    throw err;
  }
  reply
    .header('Content-Type', file.contentType)
    .header('Content-Length', size)
    .header('Content-Disposition', `attachment; filename*=UTF-8''${rfc5987(file.downloadName)}`);
  return reply.send(createReadStream(file.absPath));
}

/** The original file, as a download. */
export async function getUpload(req: FastifyRequest, reply: FastifyReply) {
  const { fileId } = validate(FileIdParams, req.params);
  const { absPath, originalName, contentType } = await uploadsService(req.server.pg).original(userOf(req), fileId);
  return sendDownload(reply, { absPath, downloadName: originalName, contentType });
}

export async function deleteUpload(req: FastifyRequest, reply: FastifyReply) {
  const { fileId } = validate(FileIdParams, req.params);
  await uploadsService(req.server.pg).remove(userOf(req), fileId);
  reply.code(204).send();
}

// --- Jobs ---------------------------------------------------------------------------------

/** Queue an import of one of the user's uploads. Owner only; no revision (the job bumps the map). */
export async function createImport(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  const body = validate(ImportBody, req.body);
  reply.code(201).send(await jobsService(req.server.pg).enqueueImport(userOf(req), mapId, body));
}

/** Queue an export of the map. The owner and recipients may export. */
export async function createExport(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  const body = validate(ExportBody, req.body);
  reply.code(201).send(await jobsService(req.server.pg).enqueueExport(userOf(req), mapId, body));
}

export async function previewExport(req: FastifyRequest, reply: FastifyReply) {
  const { mapId } = validate(MapIdParams, req.params);
  const query = validate(ExportPreviewQuery, req.query);
  reply.send(await jobsService(req.server.pg).preview(userOf(req), mapId, query));
}

export async function listJobs(req: FastifyRequest, reply: FastifyReply) {
  const query = validate(JobsQuery, req.query);
  reply.send({ jobs: await jobsService(req.server.pg).list(userOf(req), query) });
}

export async function getJob(req: FastifyRequest, reply: FastifyReply) {
  const { jobId } = validate(JobIdParams, req.params);
  reply.send({ job: await jobsService(req.server.pg).get(userOf(req), jobId) });
}

/** A succeeded export's file, as a download. */
export async function downloadJob(req: FastifyRequest, reply: FastifyReply) {
  const { jobId } = validate(JobIdParams, req.params);
  return sendDownload(reply, await jobsService(req.server.pg).download(userOf(req), jobId));
}

// --- Admin --------------------------------------------------------------------------------

/** Counts and sizes per owner. Never titles or content; admin sees no one's map. */
export async function adminSummary(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ owners: await adminSummaryQuery(req.server.pg) });
}
