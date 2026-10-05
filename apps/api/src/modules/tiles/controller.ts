import type { FastifyReply, FastifyRequest } from 'fastify';
import { activeVersions, tileSql, TILE_LAYERS, type TileLayer } from './repository';

const MAX_ZOOM = 16;

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
  const z = Number(p.z), x = Number(p.x), y = yMatch ? Number(yMatch[1]) : NaN;
  const n = 2 ** z;
  if (!Number.isInteger(z) || z < 0 || z > MAX_ZOOM || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) {
    return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid tile coordinates' } });
  }
  // A tile is immutable at a given active version: a URL that names it is cached for good, and the
  // next activation changes the version, so the next URL is new. Anything else must be revalidated.
  const wanted = (req.query as { v?: string }).v;
  const active = await activeVersions(req.server.pg);
  const current = active[layer === 'lakes' ? 'lakes' : 'rivers'];
  const cacheable = wanted !== undefined && wanted === current;
  const { rows } = await req.server.pg.query<{ tile: Buffer | null }>(tileSql(layer), [z, x, y]);
  const body = rows[0]?.tile;
  reply.header('Cache-Control', cacheable ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (!body || body.length === 0) return reply.code(204).send();
  return reply.header('Content-Type', 'application/vnd.mapbox-vector-tile').send(body);
}
