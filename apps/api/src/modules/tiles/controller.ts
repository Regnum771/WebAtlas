import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { activeVersions, tileSql, TILE_LAYERS, type TileLayer } from './repository';

const MAX_ZOOM = 16;
const gzipAsync = promisify(gzip);

export async function versions(req: FastifyRequest, reply: FastifyReply) {
  reply.header('Cache-Control', 'no-cache').send(await activeVersions(req.server.pg));
}

export async function tile(req: FastifyRequest, reply: FastifyReply) {
  const p = req.params as { layer: string; z: string; x: string; y: string };
  if (!(TILE_LAYERS as readonly string[]).includes(p.layer)) {
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `No tile layer "${p.layer}"` } });
  }
  const layer = p.layer as TileLayer;
  const yMatch = /^(\d+)\.pbf$/.exec(p.y);
  // Digits only: Number() alone would accept "1e1", " 5" or "".
  const digits = /^\d+$/;
  const z = digits.test(p.z) ? Number(p.z) : NaN, x = digits.test(p.x) ? Number(p.x) : NaN, y = yMatch ? Number(yMatch[1]) : NaN;
  const n = 2 ** z;
  if (!Number.isInteger(z) || z < 0 || z > MAX_ZOOM || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) {
    return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid tile coordinates' } });
  }
  // A tile is immutable at a given active version: a URL that names it is cached for good, and the
  // next activation changes the version, so the next URL is new. Anything else must be revalidated.
  const wanted = (req.query as { v?: string }).v;
  const active = await activeVersions(req.server.pg);
  const current = active[layer === 'lakes' ? 'lakes' : layer === 'wards' ? 'wards' : 'rivers'];
  const cacheable = wanted !== undefined && wanted === current;
  const { rows } = await req.server.pg.query<{ tile: Buffer | null }>(tileSql(layer), [z, x, y]);
  const body = rows[0]?.tile;
  reply.header('Cache-Control', cacheable ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (!body || body.length === 0) return reply.code(204).send();
  reply.header('Content-Type', 'application/vnd.mapbox-vector-tile').header('Vary', 'Accept-Encoding');
  // Tiles are highly compressible (a zoom-8 rivers tile shrinks to a fraction); gzip when the client accepts it.
  if (String(req.headers['accept-encoding'] ?? '').toLowerCase().includes('gzip')) {
    return reply.header('Content-Encoding', 'gzip').send(await gzipAsync(body));
  }
  return reply.send(body);
}
