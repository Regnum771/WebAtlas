import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { Pool, PoolClient } from 'pg';
import { AppError, FileTooLargeError, NotFoundError, QuotaExceededError, ValidationError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import type { CurrentUser } from '../../types/fastify';
import { resolveInStore, unlinkInStore, writeStream } from './fileStore';

/*
 * Uploads: files a user stores to import later. Each lives at
 * uploads/<ownerId>/<fileId>/original<ext> in the file store, with a workspace.files row of kind
 * 'upload'. Only the owner sees, reads or deletes an upload; anyone else gets the same 404 as for
 * a file that does not exist.
 *
 * Quota: workspace.usage_bytes(owner) against app.users.quota_bytes. The write is capped at the
 * room left, so a file that cannot fit stops early; the check is then repeated in the transaction
 * that inserts the row, with the owner's user row locked so that concurrent uploads by the same
 * owner take turns. A refused upload leaves no row and no file.
 */

/** 200 MB per file. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Extensions an upload may have (the formats the worker reads), lower case. */
export const UPLOAD_EXTENSIONS: readonly string[] = ['.gpkg', '.geojson', '.json', '.zip', '.kml', '.tif', '.tiff'];

export const FILE_NOT_FOUND = 'Không tìm thấy tệp.';
export const FILE_IN_USE = 'Tệp đang được dùng cho một công việc chuỗi thời gian, chưa xoá được.';
const UNSUPPORTED_FORMAT = 'Định dạng tệp không được hỗ trợ.';

export interface Upload {
  id: string;
  originalName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface UploadPart {
  filename: string;
  mimetype: string;
  file: Readable;
}

interface UploadRow {
  id: string;
  original_name: string;
  size_bytes: string; // bigint
  created_at: Date;
}

const UPLOAD_COLS = 'id, original_name, size_bytes, created_at';

/**
 * An upload whose delete_after has passed is gone, whether or not the sweep has removed it yet:
 * it is neither listed nor served (as jobs.ts enqueueImport refuses to import it).
 */
const NOT_EXPIRED = '(delete_after IS NULL OR delete_after > now())';

function toUpload(row: UploadRow): Upload {
  return {
    id: row.id,
    originalName: row.original_name,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at.toISOString(),
  };
}

/** Bytes as MB (MiB) with one decimal and a Vietnamese decimal comma: 1572864 -> "1,5 MB". */
function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function quotaExceeded(usedBytes: number, quotaBytes: number): QuotaExceededError {
  return new QuotaExceededError(`Vượt hạn mức dung lượng: đã dùng ${mb(usedBytes)}, hạn mức ${mb(quotaBytes)}.`);
}

type Queryable = Pool | PoolClient;

/** The owner's usage and quota. */
export async function usageOf(q: Queryable, ownerId: string) {
  const { rows } = await q.query<{ usage: string; quota: string }>(
    `SELECT workspace.usage_bytes(u.id) AS usage, u.quota_bytes AS quota
       FROM app.users u WHERE u.id = $1`,
    [ownerId]
  );
  if (!rows[0]) throw new NotFoundError(FILE_NOT_FOUND);
  return { usageBytes: Number(rows[0].usage), quotaBytes: Number(rows[0].quota) };
}

export interface StoreOptions {
  maxBytes: number;
  extensions: readonly string[];
  /** workspace.files.purpose: 'map' for a personal upload, 'timeseries' for the catalogue. */
  purpose: 'map' | 'timeseries';
  /** False for an upload that does not count toward the personal quota (and is not capped by it). */
  countsToQuota: boolean;
  /** A lower cap for some extensions (lower case, with the dot); the lowest cap applies. */
  extensionMaxBytes?: Record<string, number>;
  /**
   * An upload that expires unless something takes it: delete_after = now + deleteAfterDays, and
   * the owner's uploads of this purpose that still carry a date (not yet imported) may not total
   * more than pendingCapBytes. The import clears the date (import_timeseries.py keep_uploads).
   */
  expiry?: { deleteAfterDays: number; pendingCapBytes: number; overCap: () => Error };
  unsupportedMessage?: string;
  tooLargeMessage?: string | ((ext: string) => string);
}

/** Bytes of the owner's uploads of a purpose that still expire (not yet imported). */
async function pendingBytes(q: Queryable, ownerId: string, purpose: string): Promise<number> {
  const { rows } = await q.query<{ n: string }>(
    `SELECT COALESCE(sum(size_bytes), 0) AS n FROM workspace.files
      WHERE owner_id = $1 AND kind = 'upload' AND purpose = $2 AND delete_after IS NOT NULL`,
    [ownerId, purpose]
  );
  return Number(rows[0].n);
}

/**
 * Stream one multipart file into the store and record it as an upload of `user`. The quota rules
 * in the header apply when `countsToQuota`; otherwise only `maxBytes` (and `expiry`'s pending
 * cap, when given) limit the file.
 */
export async function storeUpload(pg: Pool, user: CurrentUser, part: UploadPart, opts: StoreOptions): Promise<{ upload: Upload }> {
  const { countsToQuota, expiry } = opts;
  const ext = path.extname(part.filename ?? '').toLowerCase();
  const maxBytes = Math.min(opts.maxBytes, opts.extensionMaxBytes?.[ext] ?? Infinity);
  if (!opts.extensions.includes(ext)) {
    part.file.resume(); // let the request body drain
    throw new ValidationError(opts.unsupportedMessage ?? UNSUPPORTED_FORMAT);
  }

  let quotaRoom = Infinity;
  let before = { usageBytes: 0, quotaBytes: 0 };
  if (countsToQuota) {
    before = await usageOf(pg, user.id);
    quotaRoom = Math.max(0, before.quotaBytes - before.usageBytes);
    if (quotaRoom === 0) {
      part.file.resume();
      throw quotaExceeded(before.usageBytes, before.quotaBytes);
    }
  }
  let pendingRoom = Infinity;
  if (expiry) {
    pendingRoom = Math.max(0, expiry.pendingCapBytes - (await pendingBytes(pg, user.id, opts.purpose)));
    if (pendingRoom === 0) {
      part.file.resume();
      throw expiry.overCap();
    }
  }
  const room = Math.min(quotaRoom, pendingRoom);

  const fileId = randomUUID();
  const relPath = `uploads/${user.id}/${fileId}/original${ext}`;
  let sizeBytes: number;
  try {
    sizeBytes = await writeStream(relPath, part.file, Math.min(maxBytes, room));
  } catch (err) {
    if (err instanceof FileTooLargeError) {
      // Stopped at the room left rather than at the per-file limit: report the limit that applied.
      if (room < maxBytes) throw pendingRoom < quotaRoom ? expiry!.overCap() : quotaExceeded(before.usageBytes, before.quotaBytes);
      if (opts.tooLargeMessage) {
        throw new FileTooLargeError(typeof opts.tooLargeMessage === 'function' ? opts.tooLargeMessage(ext) : opts.tooLargeMessage);
      }
    }
    throw err;
  }

  try {
    const row = await inTransaction(pg, async (client) => {
      // Lock the owner first so concurrent uploads by the same owner recheck one at a time.
      await client.query(`SELECT 1 FROM app.users WHERE id = $1 FOR UPDATE`, [user.id]);
      const { rows } = await client.query<UploadRow>(
        `INSERT INTO workspace.files (id, owner_id, kind, path, original_name, content_type, size_bytes, purpose, delete_after)
         VALUES ($1, $2, 'upload', $3, $4, $5, $6, $7,
                 CASE WHEN $8::int IS NULL THEN NULL ELSE now() + make_interval(days => $8::int) END)
         RETURNING ${UPLOAD_COLS}`,
        [fileId, user.id, relPath, part.filename, part.mimetype || 'application/octet-stream', sizeBytes, opts.purpose,
         expiry?.deleteAfterDays ?? null]
      );
      if (countsToQuota) {
        const after = await usageOf(client, user.id);
        if (after.usageBytes > after.quotaBytes) throw quotaExceeded(after.usageBytes - sizeBytes, after.quotaBytes);
      }
      if (expiry && (await pendingBytes(client, user.id, opts.purpose)) > expiry.pendingCapBytes) throw expiry.overCap();
      return rows[0];
    });
    return { upload: toUpload(row) };
  } catch (err) {
    // The row was rolled back; the file goes too. The original error is the one reported.
    await unlinkInStore(relPath).catch(() => undefined);
    throw err;
  }
}

export function uploadsService(pg: Pool, opts: { maxBytes?: number } = {}) {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;

  return {
    upload(user: CurrentUser, part: UploadPart): Promise<{ upload: Upload }> {
      return storeUpload(pg, user, part, {
        maxBytes, extensions: UPLOAD_EXTENSIONS, purpose: 'map', countsToQuota: true,
      });
    },

    /** The owner's uploads. One whose delete_after has passed is gone (NOT_EXPIRED). Time-series uploads belong to the catalogue and are not listed. */
    async list(user: CurrentUser): Promise<Upload[]> {
      const { rows } = await pg.query<UploadRow>(
        `SELECT ${UPLOAD_COLS} FROM workspace.files
          WHERE owner_id = $1 AND kind = 'upload' AND purpose = 'map' AND ${NOT_EXPIRED}
          ORDER BY created_at DESC, id`,
        [user.id]
      );
      return rows.map(toUpload);
    },

    /** What GET /uploads reports beside the list. */
    usage(user: CurrentUser): Promise<{ usageBytes: number; quotaBytes: number }> {
      return usageOf(pg, user.id);
    },

    /** Delete the row, then the file. */
    async remove(user: CurrentUser, fileId: string): Promise<void> {
      // The row is locked first (enqueue locks it too), so a job cannot be queued between the check and the delete.
      const filePath = await inTransaction(pg, async (client) => {
        const { rows } = await client.query<{ path: string }>(
          `SELECT path FROM workspace.files WHERE id = $1 AND owner_id = $2 AND kind = 'upload' FOR UPDATE`,
          [fileId, user.id]
        );
        if (!rows[0]) throw new NotFoundError(FILE_NOT_FOUND);
        const busy = await client.query(
          `SELECT 1 FROM workspace.jobs j
            WHERE j.kind = 'timeseries_import' AND j.status IN ('queued', 'running')
              AND (j.params->>'fileId' = $1::text OR j.params->>'timesCsvPath' = $2)
            LIMIT 1`,
          [fileId, rows[0].path]
        );
        if (busy.rowCount) throw new AppError(409, 'FILE_IN_USE', FILE_IN_USE);
        await client.query(`DELETE FROM workspace.files WHERE id = $1`, [fileId]);
        return rows[0].path;
      });
      await unlinkInStore(filePath);
    },

    async original(user: CurrentUser, fileId: string): Promise<{ absPath: string; originalName: string; contentType: string }> {
      const { rows } = await pg.query<{ path: string; original_name: string; content_type: string }>(
        `SELECT path, original_name, content_type FROM workspace.files
          WHERE id = $1 AND owner_id = $2 AND kind = 'upload' AND purpose = 'map' AND ${NOT_EXPIRED}`,
        [fileId, user.id]
      );
      if (!rows[0]) throw new NotFoundError(FILE_NOT_FOUND);
      return { absPath: resolveInStore(rows[0].path), originalName: rows[0].original_name, contentType: rows[0].content_type };
    },
  };
}
