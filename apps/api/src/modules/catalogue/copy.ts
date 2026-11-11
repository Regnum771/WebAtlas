import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { AppError, AuthError, ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import { validate } from '../../lib/validate';
import { geoserverUrl } from '../../geoserver/client';
import type { CurrentUser } from '../../types/fastify';
import { MAP_NOT_FOUND, OWNER_ONLY, mapRole } from '../workspace/access';
import { IMPORT_MAX_ROWS, jobsService, type Job } from '../workspace/jobs';
import { uploadsService } from '../workspace/uploads';
import { catalogueRepository, type CatalogueItem } from './repository';
import { IdParams } from './schemas';
import { geoserverGet, workspaceOf } from './proxy';

/*
 * "Sao vào Bản của tôi": copy a catalogue entry into one of the caller's personal maps. The API
 * reads the data from GeoServer with the admin account (a vector layer as GeoJSON over WFS, a
 * single raster as GeoTIFF over WCS), stores it as an ordinary map upload of the caller's (purpose
 * 'map', counted in their quota, capped at 200 MB like any upload), then queues the workspace
 * import job into the map. Everything after the copy is the personal-map import: same owner
 * check, same steps, same row limit. Time series, maps and documents are added as links only.
 */

export const LINK_ONLY = 'Mục này chỉ thêm được dạng liên kết.';
export const COPY_FAILED = 'Không đọc được dữ liệu từ máy chủ bản đồ, hãy thử lại sau.';
export const NO_DOWNLOAD = 'Dữ liệu này không cho phép tải về nên không sao được; hãy lưu dạng liên kết.';
/** How long the copy waits on GeoServer for the whole download. */
export const COPY_TIMEOUT_MS = 10 * 60_000;

export const CopyBody = z.object({ mapId: z.string().uuid() });

interface Source { url: string; ext: '.geojson' | '.tif'; mimetype: string; accepts: RegExp }

function sourceOf(item: CatalogueItem): Source {
  const ws = workspaceOf(item.layerName);
  const name = item.layerName.includes(':') ? item.layerName.slice(item.layerName.indexOf(':') + 1) : item.layerName;
  const ows = `${geoserverUrl()}/${ws}/ows`;
  if (item.kind === 'vector') {
    // WFS 1.0.0 keeps x/y (lon/lat) order in EPSG:4326, which is what a GeoJSON reader expects.
    // One feature more than the import takes, so a layer over the limit fails the import
    // (worker.py's row check) rather than arriving silently cut short.
    const q = new URLSearchParams({
      service: 'WFS', version: '1.0.0', request: 'GetFeature', typeName: item.layerName,
      outputFormat: 'application/json', srsName: 'EPSG:4326', maxFeatures: String(IMPORT_MAX_ROWS + 1),
    });
    return { url: `${ows}?${q}`, ext: '.geojson', mimetype: 'application/geo+json', accepts: /json/i };
  }
  // WCS 2.0 names a coverage <workspace>__<layer>.
  const q = new URLSearchParams({
    service: 'WCS', version: '2.0.1', request: 'GetCoverage', coverageId: `${ws}__${name}`, format: 'image/tiff',
  });
  return { url: `${ows}?${q}`, ext: '.tif', mimetype: 'image/tiff', accepts: /tiff/i };
}

/**
 * The stored file's name: the entry's title with the characters a file name cannot hold replaced
 * by '_'. The new layer is named after the title itself (passed to the import).
 */
export function copyFileName(title: string, ext: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
    .replace(/^\.+/, '');
  return `${base || 'du-lieu'}${ext}`;
}

const upstreamFailed = () => new AppError(502, 'UPSTREAM_ERROR', COPY_FAILED);

export function catalogueCopyService(pg: Pool) {
  return {
    async copy(user: CurrentUser, id: string, mapId: string): Promise<{ job: Job }> {
      const item = await catalogueRepository(pg).get(user, id); // 404 when not visible
      if (item.kind !== 'vector' && item.kind !== 'raster') throw new ValidationError(LINK_ONLY);
      // GeoNode's download permission (or ownership): the read below uses the admin account.
      if (!item.downloadable) throw new ForbiddenError(NO_DOWNLOAD);
      // The import's own owner check, made before anything is read, so a refused copy costs nothing.
      const role = await mapRole(pg, mapId, user.id);
      if (role === null) throw new NotFoundError(MAP_NOT_FOUND);
      if (role !== 'owner') throw new ForbiddenError(OWNER_ONLY);

      const source = sourceOf(item);
      let res: Response;
      try {
        res = await geoserverGet(source.url, AbortSignal.timeout(COPY_TIMEOUT_MS));
      } catch {
        throw upstreamFailed();
      }
      // A 200 can still be an OWS exception report (XML) rather than the data asked for.
      if (!res.ok || !res.body || !source.accepts.test(res.headers.get('content-type') ?? '')) {
        await res.body?.cancel().catch(() => undefined);
        throw upstreamFailed();
      }

      const file = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
      const uploads = uploadsService(pg);
      let uploadId: string;
      try {
        const { upload } = await uploads.upload(user, { filename: copyFileName(item.title, source.ext), mimetype: source.mimetype, file });
        uploadId = upload.id;
      } catch (err) {
        // storeUpload leaves a refused source flowing to drain it; GeoServer's body has no end
        // worth waiting for, so stop reading it.
        file.destroy();
        // A refusal (quota, type) is an AppError and goes out as is; anything else is the GeoServer
        // body failing mid-read (the 10-minute timeout, a dropped connection): a copy failure.
        if (err instanceof AppError) throw err;
        throw upstreamFailed();
      }

      try {
        // The layer is named after the entry verbatim, not after the sanitised file name.
        return await jobsService(pg).enqueueImport(user, mapId, { fileId: uploadId, title: item.title });
      } catch (err) {
        // The map went away (or changed hands) since the check: the copy is of no use.
        await uploads.remove(user, uploadId).catch(() => undefined);
        throw err;
      }
    },
  };
}

/** POST /api/catalogue/:id/copy {mapId} — signed in; 202 {job}. */
export async function copyToMap(req: FastifyRequest, reply: FastifyReply) {
  if (!req.currentUser) throw new AuthError();
  const { id } = validate(IdParams, req.params);
  const { mapId } = validate(CopyBody, req.body);
  reply.code(202).send(await catalogueCopyService(req.server.pg).copy(req.currentUser, id, mapId));
}
