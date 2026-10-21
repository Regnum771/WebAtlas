import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { NotFoundError } from '../../errors';
import type { CurrentUser } from '../../types/fastify';
import { assertCanRead } from './access';
import { resolveInStore } from './fileStore';
import { FILE_NOT_FOUND } from './uploads';

/*
 * Raster layers: the Cloud-Optimized GeoTIFF the worker made from an uploaded GeoTIFF
 * (import_raster.py), served by byte range so a map client reads only the tiles and overviews it
 * shows. Whoever may read the map (its owner and its recipients) may read its rasters; anyone
 * else gets the map's 404 (access.ts), before the layer is even looked up.
 */

/** What a Range header asks for, against a file of a known size. */
export type ByteRange =
  | { kind: 'all' }
  | { kind: 'part'; start: number; end: number }
  | { kind: 'unsatisfiable' };

// One range: "a-b", "a-" or the suffix "-n". The unit is case-insensitive (RFC 9110 §14.1).
const SINGLE_RANGE = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i;

/**
 * The part of a `size`-byte file a Range header asks for (RFC 9110 §14). A header that is absent,
 * names another unit, lists several ranges, or does not parse is ignored: the whole file, as the
 * RFC allows. A single range that starts at or past the end (or a suffix of zero bytes) cannot be
 * satisfied; an end past the file is clamped to its last byte.
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  const m = header === undefined ? null : SINGLE_RANGE.exec(header);
  if (!m) return { kind: 'all' };
  const [, first, last] = m;
  if (first === '' && last === '') return { kind: 'all' };
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'part', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (last !== '' && Number(last) < start) return { kind: 'all' }; // an invalid range-spec
  if (start >= size) return { kind: 'unsatisfiable' };
  return { kind: 'part', start, end: last === '' ? size - 1 : Math.min(Number(last), size - 1) };
}

export interface RasterFile {
  absPath: string;
  size: number;
}

export function rastersService(pg: Pool) {
  return {
    /**
     * The COG of a raster layer the user may read. The caller has established that the layer is a
     * raster of this map; a layer whose files row is gone (file_id NULL), or whose file is missing
     * from the store, is a missing file.
     */
    async cog(user: CurrentUser, mapId: string, layerId: string): Promise<RasterFile> {
      await assertCanRead(pg, mapId, user);
      const { rows } = await pg.query<{ path: string }>(
        `SELECT f.path
           FROM workspace.map_layers l
           JOIN workspace.files f ON f.id = l.file_id AND f.kind = 'cog'
          WHERE l.id = $1 AND l.map_id = $2 AND l.kind = 'raster'`,
        [layerId, mapId]
      );
      if (!rows[0]) throw new NotFoundError(FILE_NOT_FOUND);
      const absPath = resolveInStore(rows[0].path);
      try {
        const info = await stat(absPath);
        if (!info.isFile()) throw new NotFoundError(FILE_NOT_FOUND);
        return { absPath, size: info.size };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(FILE_NOT_FOUND);
        throw err;
      }
    },
  };
}

/**
 * Send a COG: 206 with the one range asked for, 416 when it cannot be satisfied, otherwise 200 with
 * the whole file. A conditional range (If-Range) is served whole: there is no validator to check
 * it against.
 */
export function sendRaster(req: FastifyRequest, reply: FastifyReply, file: RasterFile) {
  const range = req.headers['if-range'] !== undefined ? { kind: 'all' as const } : parseRange(req.headers.range, file.size);
  reply.header('Accept-Ranges', 'bytes');
  if (range.kind === 'unsatisfiable') {
    return reply.code(416).header('Content-Range', `bytes */${file.size}`).send();
  }
  reply.header('Content-Type', 'image/tiff');
  if (range.kind === 'all') {
    return reply.header('Content-Length', file.size).send(createReadStream(file.absPath));
  }
  return reply
    .code(206)
    .header('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`)
    .header('Content-Length', range.end - range.start + 1)
    .send(createReadStream(file.absPath, { start: range.start, end: range.end }));
}
