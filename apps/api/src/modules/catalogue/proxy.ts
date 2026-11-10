import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ValidationError } from '../../errors';
import { validate } from '../../lib/validate';
import { authHeader, geoserverUrl } from '../../geoserver/client';
import { catalogueRepository } from './repository';
import { IdParams } from './schemas';

/*
 * The map-image proxy for catalogue entries: GET /api/catalogue/:id/wms. The browser never talks
 * to GeoServer itself (an unpublished entry is served with the admin account, so the visibility
 * rule of access.ts is the only gate). Only a few WMS requests pass, always for the entry's own
 * layer: LAYERS / QUERY_LAYERS / LAYER are overwritten, every parameter outside PASS_THROUGH is
 * dropped (SLD, SLD_BODY, ENV, ... could reach other layers or GeoServer's files), and images are
 * at most MAX_SIZE pixels a side.
 */

export const UPSTREAM_FAILED = 'Máy chủ bản đồ không trả được ảnh, hãy thử lại sau.';
export const BAD_WMS_REQUEST = 'Yêu cầu bản đồ không hợp lệ.';
export const IMAGE_TOO_LARGE = 'Ảnh bản đồ tối đa 2048 điểm ảnh mỗi chiều.';
export const MAX_SIZE = 2048;
const CACHE_SECONDS = 300;

/** How the proxy and the copy reach GeoServer. Replaced in tests (setGeoserverFetch). */
export type GeoserverFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;
const realFetch: GeoserverFetch = (url, init) => fetch(url, init);
let gsFetch: GeoserverFetch = realFetch;

/** Test seam: route GeoServer calls to `fn`; null restores the real fetch. */
export function setGeoserverFetch(fn: GeoserverFetch | null): void {
  gsFetch = fn ?? realFetch;
}

/** A GET on GeoServer with the admin account. */
export function geoserverGet(url: string, signal?: AbortSignal): Promise<Response> {
  return gsFetch(url, { headers: { Authorization: authHeader() }, ...(signal ? { signal } : {}) });
}

/**
 * The GeoServer workspace of a layer name (`geonode:ts_ab12cd34` -> `geonode`), which picks the
 * virtual-service path. A name without one is in `geonode`, where GeoNode puts its datasets.
 */
export function workspaceOf(layerName: string): string {
  const i = layerName.indexOf(':');
  const ws = i > 0 ? layerName.slice(0, i) : 'geonode';
  // Goes into the URL path: a name GeoServer would never give a workspace is a corrupt row.
  if (!/^[A-Za-z0-9_-]+$/.test(ws)) throw new AppError(502, 'UPSTREAM_ERROR', UPSTREAM_FAILED);
  return ws;
}

/** Canonical spelling of each allowed REQUEST, by its upper-case form. */
const REQUESTS: Record<string, string> = {
  GETMAP: 'GetMap',
  GETLEGENDGRAPHIC: 'GetLegendGraphic',
  GETFEATUREINFO: 'GetFeatureInfo',
};

const PASS_THROUGH = new Set([
  'VERSION', 'BBOX', 'WIDTH', 'HEIGHT', 'SRS', 'CRS', 'FORMAT', 'TRANSPARENT', 'TIME', 'STYLES',
  'I', 'J', 'X', 'Y', 'INFO_FORMAT', 'FEATURE_COUNT', 'TILED', 'LEGEND_OPTIONS',
]);

/**
 * The query string sent to GeoServer from the client's one. Parameter names are matched ignoring
 * case (as WMS does) and sent upper case; a parameter given twice is refused, since GeoServer and
 * this check might read different copies.
 */
export function wmsQuery(query: Record<string, unknown>, layerName: string): URLSearchParams {
  const params = new Map<string, string>();
  for (const [key, value] of Object.entries(query)) {
    const name = key.toUpperCase();
    if (Array.isArray(value) || params.has(name)) throw new ValidationError(BAD_WMS_REQUEST);
    params.set(name, typeof value === 'string' ? value : String(value ?? ''));
  }

  const service = params.get('SERVICE');
  if (service !== undefined && service.toUpperCase() !== 'WMS') throw new ValidationError(BAD_WMS_REQUEST);
  const request = REQUESTS[(params.get('REQUEST') ?? '').toUpperCase()];
  if (!request) throw new ValidationError(BAD_WMS_REQUEST);
  for (const side of ['WIDTH', 'HEIGHT']) {
    const v = params.get(side);
    if (v === undefined) continue;
    if (!/^\d{1,5}$/.test(v)) throw new ValidationError(BAD_WMS_REQUEST);
    if (Number(v) > MAX_SIZE) throw new ValidationError(IMAGE_TOO_LARGE);
  }

  const out = new URLSearchParams({ SERVICE: 'WMS', REQUEST: request });
  for (const [name, value] of params) if (PASS_THROUGH.has(name)) out.set(name, value);
  // Always the entry's own layer, whatever the client named (GeoServer ignores the ones a request does not use).
  out.set('LAYERS', layerName);
  out.set('QUERY_LAYERS', layerName);
  out.set('LAYER', layerName);
  return out;
}

/** GET /api/catalogue/:id/wms — optional auth; 404 for an entry the caller cannot see. */
export async function wmsProxy(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(IdParams, req.params);
  const item = await catalogueRepository(req.server.pg).get(req.currentUser, id);
  const query = wmsQuery(req.query as Record<string, unknown>, item.layerName);
  const url = `${geoserverUrl()}/${workspaceOf(item.layerName)}/wms?${query}`;

  // Stop waiting on GeoServer when the client goes away before the answer (the response's
  // 'close'; the request's fires as soon as its empty body is read). Once streaming, Fastify
  // destroys the body stream on a premature close, which cancels the fetch.
  const abort = new AbortController();
  reply.raw.on('close', () => abort.abort());
  let upstream: Response;
  try {
    upstream = await geoserverGet(url, abort.signal);
  } catch (err) {
    req.log.warn({ err }, 'catalogue wms proxy: GeoServer unreachable');
    throw new AppError(502, 'UPSTREAM_ERROR', UPSTREAM_FAILED);
  }
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  // A WMS 1.1.1 exception comes back as 200 se_xml: it is as much a failure as a 5xx, and its
  // text (paths, layer names) is not for the client.
  if (!upstream.ok || !upstream.body || /vnd\.ogc\.se_xml/i.test(contentType)) {
    req.log.warn({ status: upstream.status, contentType }, 'catalogue wms proxy: GeoServer refused');
    await upstream.body?.cancel().catch(() => undefined);
    throw new AppError(502, 'UPSTREAM_ERROR', UPSTREAM_FAILED);
  }

  reply
    .header('content-type', contentType)
    .header('cache-control', `${item.isPublished ? 'public' : 'private'}, max-age=${CACHE_SECONDS}`)
    // The web app (another origin) shows legends as plain <img>; helmet's same-origin default blocks that.
    .header('cross-origin-resource-policy', 'cross-origin')
    // An HTML answer (FORMAT or INFO_FORMAT text/html, carrying the layer's attribute values) is
    // never run as a page on the API's origin.
    .header('content-security-policy', "default-src 'none'; sandbox");
  return reply.send(Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>));
}
