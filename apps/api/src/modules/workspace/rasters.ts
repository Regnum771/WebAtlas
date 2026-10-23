import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { NotFoundError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import type { CurrentUser } from '../../types/fastify';
import { assertCanRead, bumpMap, lockMapForWrite } from './access';
import { resolveInStore } from './fileStore';
import { LAYER_NOT_FOUND, deleteLayerRow, loadSummary, patchLayerRow } from './freeLayers';
import type { LayerSummary } from './maps';
import { FILE_NOT_FOUND } from './uploads';

/*
 * Raster layers: the Cloud-Optimized GeoTIFF the worker made from an uploaded GeoTIFF
 * (import_raster.py), served by byte range so a map client reads only the tiles and overviews it
 * shows. Whoever may read the map (its owner and its recipients) may read its rasters; anyone
 * else gets the map's 404 (access.ts), before the layer is even looked up. The owner may rename,
 * restyle, move and delete a raster layer. Deleting one (or its map) schedules its COG for
 * removal (scheduleCogRemoval); the cleanup sweep removes the file (cleanup.ts deleteExpiredFiles).
 */

/**
 * In the caller's transaction, before the layer rows go: give the COGs of these raster layers a
 * delete_after of now(), so the next cleanup sweep removes them and they stop counting toward
 * the quota at once. A COG that a layer outside this set still shows is left alone, and an earlier
 * date already set is kept. The API never unlinks a file inside a request.
 */
export async function scheduleCogRemoval(client: PoolClient, layerIds: string[]): Promise<void> {
  if (layerIds.length === 0) return;
  await client.query(
    `UPDATE workspace.files f
        SET delete_after = LEAST(f.delete_after, now())
      WHERE f.kind = 'cog'
        AND f.id IN (SELECT l.file_id FROM workspace.map_layers l
                      WHERE l.id = ANY($1::uuid[]) AND l.kind = 'raster')
        AND NOT EXISTS (SELECT 1 FROM workspace.map_layers o
                         WHERE o.file_id = f.id AND NOT (o.id = ANY($1::uuid[])))`,
    [layerIds]
  );
}

/** What a Range header asks for, against a file of a known size. */
export type ByteRange =
  | { kind: 'all' }
  | { kind: 'part'; start: number; end: number }
  | { kind: 'unsatisfiable' };

// One range: "a-b", "a-" or the suffix "-n". The unit is case-insensitive (RFC 9110 §14.1).
// No whitespace inside the value and no two adjacent quantifiers that can share characters, so
// matching is linear: a regex that lets `\s*` and `\d*` trade characters backtracks
// polynomially, and a padded header would freeze the event loop.
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/i;
// Far longer than any single range (two 16-digit offsets); a longer header is not one.
const RANGE_HEADER_MAX = 200;

/**
 * The part of a `size`-byte file a Range header asks for (RFC 9110 §14). A header that is absent,
 * too long, names another unit, lists several ranges, or does not parse is ignored: the whole
 * file, as the RFC allows. A single range that starts at or past the end (or a suffix of zero
 * bytes) cannot be satisfied; an end past the file is clamped to its last byte.
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  if (header === undefined || header.length > RANGE_HEADER_MAX) return { kind: 'all' };
  const m = SINGLE_RANGE.exec(header.trim());
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
    /** Rename, restyle or move a raster layer, through the layer-row helpers every kind shares. */
    async updateLayer(
      user: CurrentUser, mapId: string, layerId: string,
      input: { title?: string; style?: Record<string, unknown>; position?: number; expectedRevision: number }
    ): Promise<{ layer: LayerSummary; revision: number }> {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        const { rows } = await client.query(
          `SELECT 1 FROM workspace.map_layers WHERE id = $1 AND map_id = $2 AND kind = 'raster'`, [layerId, mapId]
        );
        if (!rows[0]) throw new NotFoundError(LAYER_NOT_FOUND);
        await patchLayerRow(client, mapId, layerId, input);
        const revision = await bumpMap(client, mapId);
        return { layer: await loadSummary(client, layerId), revision };
      });
    },

    /**
     * Delete a raster layer: the map row is locked first, then the layer row; its COG is
     * scheduled for removal and the row deleted, in one transaction.
     */
    async removeLayer(
      user: CurrentUser, mapId: string, layerId: string, input: { expectedRevision: number }
    ): Promise<{ revision: number }> {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        const { rows } = await client.query(
          `SELECT 1 FROM workspace.map_layers WHERE id = $1 AND map_id = $2 AND kind = 'raster' FOR UPDATE`,
          [layerId, mapId]
        );
        if (!rows[0]) throw new NotFoundError(LAYER_NOT_FOUND);
        await scheduleCogRemoval(client, [layerId]);
        await deleteLayerRow(client, mapId, layerId);
        return { revision: await bumpMap(client, mapId) };
      });
    },

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
