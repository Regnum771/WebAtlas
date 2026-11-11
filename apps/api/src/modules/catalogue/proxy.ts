import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, NotFoundError, ValidationError } from '../../errors';
import { validate } from '../../lib/validate';
import { authHeader, geoserverUrl } from '../../geoserver/client';
import { catalogueRepository, ITEM_NOT_FOUND } from './repository';
import { IdParams } from './schemas';

/*
 * The map-image proxy for catalogue entries: GET /api/catalogue/:id/wms. The browser never talks
 * to GeoServer itself (an unpublished entry is served with the admin account, so the visibility
 * rule of access.ts is the only gate). Only a few WMS requests pass, always for the entry's own
 * layer: LAYERS / QUERY_LAYERS / LAYER are overwritten, every parameter outside PASS_THROUGH is
 * dropped (SLD, SLD_BODY, ENV, ... could reach other layers or GeoServer's files), and images are
 * at most MAX_SIZE pixels a side. FORMAT and INFO_FORMAT come from short allow-lists (KML, the
 * OpenLayers page, RSS or a raw GeoTIFF would go around the size cap, show GeoServer's internal
 * URL or hand out raw values), and TIME names one instant (a range makes GeoServer mosaic every
 * granule). Maps and documents have no layer of their own here and are not served.
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

/** Image formats by request; the first is sent when the client names none. */
const FORMATS: Record<string, readonly string[]> = {
  GetMap: ['image/png', 'image/png8', 'image/jpeg', 'image/webp'],
  GetLegendGraphic: ['image/png'],
  // GetFeatureInfo repeats the map's FORMAT; GeoServer reads INFO_FORMAT for the answer.
  GetFeatureInfo: ['image/png', 'image/png8', 'image/jpeg', 'image/webp'],
};
const INFO_FORMATS: readonly string[] = ['application/json', 'text/plain'];
/**
 * One ISO 8601 instant to the second, with an optional zone. No list, no range, and no reduced
 * precision: GeoServer reads `2026-10-01` (or a time without seconds) as a range over the omitted
 * unit and would mosaic every granule in it.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/;

function allowed(value: string, list: readonly string[]): string {
  const v = value.trim().toLowerCase();
  if (!list.includes(v)) throw new ValidationError(BAD_WMS_REQUEST);
  return v;
}

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

  const format = params.get('FORMAT');
  params.set('FORMAT', format === undefined || format === '' ? FORMATS[request][0] : allowed(format, FORMATS[request]));
  const infoFormat = params.get('INFO_FORMAT');
  if (infoFormat !== undefined) params.set('INFO_FORMAT', allowed(infoFormat, INFO_FORMATS));
  const time = params.get('TIME');
  if (time !== undefined && !(INSTANT.test(time) && Number.isFinite(Date.parse(time)))) {
    throw new ValidationError(BAD_WMS_REQUEST);
  }

  const out = new URLSearchParams({ SERVICE: 'WMS', REQUEST: request });
  for (const [name, value] of params) if (PASS_THROUGH.has(name)) out.set(name, value);
  // Always the entry's own layer, whatever the client named (GeoServer ignores the ones a request does not use).
  out.set('LAYERS', layerName);
  out.set('QUERY_LAYERS', layerName);
  out.set('LAYER', layerName);
  return out;
}

function varyWith(prev: unknown, name: string): string {
  const list = (Array.isArray(prev) ? prev.join(',') : typeof prev === 'string' ? prev : '')
    .split(',').map((v) => v.trim()).filter(Boolean);
  if (!list.some((v) => v.toLowerCase() === name.toLowerCase())) list.push(name);
  return list.join(', ');
}

/** GET /api/catalogue/:id/wms — optional auth; 404 for an entry the caller cannot see. */
export async function wmsProxy(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(IdParams, req.params);
  const item = await catalogueRepository(req.server.pg).get(req.currentUser, id);
  // A map or document names no layer this proxy may draw (a layer group may hold unpublished members).
  if (item.kind === 'map' || item.kind === 'document') throw new NotFoundError(ITEM_NOT_FOUND);
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
  // A WMS exception comes back as a 200 too (1.1.1 se_xml, 1.3.0 text/xml): it is as much a
  // failure as a 5xx, and its text (paths, layer names) is not for the client. None of the
  // allowed formats is XML.
  if (!upstream.ok || !upstream.body || /xml/i.test(contentType)) {
    req.log.warn({ status: upstream.status, contentType }, 'catalogue wms proxy: GeoServer refused');
    await upstream.body?.cancel().catch(() => undefined);
    throw new AppError(502, 'UPSTREAM_ERROR', UPSTREAM_FAILED);
  }

  reply
    .header('content-type', contentType)
    .header('cache-control', `${item.isPublic ? 'public' : 'private'}, max-age=${CACHE_SECONDS}`)
    // The same URL answers differently by caller (an owner's private entry is a 404 for others);
    // kept beside a Vary the CORS plugin may have set already.
    .header('vary', varyWith(reply.getHeader('vary'), 'Authorization'))
    // The web app (another origin) shows legends as plain <img>; helmet's same-origin default blocks that.
    .header('cross-origin-resource-policy', 'cross-origin')
    // An HTML answer (FORMAT or INFO_FORMAT text/html, carrying the layer's attribute values) is
    // never run as a page on the API's origin.
    .header('content-security-policy', "default-src 'none'; sandbox");
  return reply.send(Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>));
}
