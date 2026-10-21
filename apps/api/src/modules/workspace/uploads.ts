import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { Pool, PoolClient } from 'pg';
import { FileTooLargeError, NotFoundError, QuotaExceededError, ValidationError } from '../../errors';
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

function quotaExceeded(usedBytes: number, quotaBytes: number): QuotaExceededError {
  return new QuotaExceededError(`Vượt hạn mức dung lượng: đã dùng ${mb(usedBytes)}, hạn mức ${mb(quotaBytes)}.`);
}

type Queryable = Pool | PoolClient;

/** The owner's usage and quota. */
async function usageOf(q: Queryable, ownerId: string) {
  const { rows } = await q.query<{ usage: string; quota: string }>(
    `SELECT workspace.usage_bytes(u.id) AS usage, u.quota_bytes AS quota
       FROM app.users u WHERE u.id = $1`,
    [ownerId]
  );
  if (!rows[0]) throw new NotFoundError(FILE_NOT_FOUND);
  return { usageBytes: Number(rows[0].usage), quotaBytes: Number(rows[0].quota) };
}

export function uploadsService(pg: Pool, opts: { maxBytes?: number } = {}) {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;

  return {
    async upload(user: CurrentUser, part: UploadPart): Promise<{ upload: Upload }> {
      const ext = path.extname(part.filename ?? '').toLowerCase();
      if (!UPLOAD_EXTENSIONS.includes(ext)) {
        part.file.resume(); // let the request body drain
        throw new ValidationError(UNSUPPORTED_FORMAT);
      }

      const before = await usageOf(pg, user.id);
      const room = Math.max(0, before.quotaBytes - before.usageBytes);
      if (room === 0) {
        part.file.resume();
        throw quotaExceeded(before.usageBytes, before.quotaBytes);
      }

      const fileId = randomUUID();
      const relPath = `uploads/${user.id}/${fileId}/original${ext}`;
      let sizeBytes: number;
      try {
        sizeBytes = await writeStream(relPath, part.file, Math.min(maxBytes, room));
      } catch (err) {
        // Stopped at the room left rather than at the per-file limit: report the quota.
        if (err instanceof FileTooLargeError && room < maxBytes) throw quotaExceeded(before.usageBytes, before.quotaBytes);
        throw err;
      }

      try {
        const row = await inTransaction(pg, async (client) => {
          // Lock the owner first so concurrent uploads by the same owner recheck one at a time.
          await client.query(`SELECT 1 FROM app.users WHERE id = $1 FOR UPDATE`, [user.id]);
          const { rows } = await client.query<UploadRow>(
            `INSERT INTO workspace.files (id, owner_id, kind, path, original_name, content_type, size_bytes)
             VALUES ($1, $2, 'upload', $3, $4, $5, $6)
             RETURNING ${UPLOAD_COLS}`,
            [fileId, user.id, relPath, part.filename, part.mimetype || 'application/octet-stream', sizeBytes]
          );
          const after = await usageOf(client, user.id);
          if (after.usageBytes > after.quotaBytes) throw quotaExceeded(after.usageBytes - sizeBytes, after.quotaBytes);
          return rows[0];
        });
        return { upload: toUpload(row) };
      } catch (err) {
        // The row was rolled back; the file goes too. The original error is the one reported.
        await unlinkInStore(relPath).catch(() => undefined);
        throw err;
      }
    },

    async list(user: CurrentUser): Promise<Upload[]> {
      const { rows } = await pg.query<UploadRow>(
        `SELECT ${UPLOAD_COLS} FROM workspace.files
          WHERE owner_id = $1 AND kind = 'upload'
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
      const { rows } = await pg.query<{ path: string }>(
        `DELETE FROM workspace.files WHERE id = $1 AND owner_id = $2 AND kind = 'upload' RETURNING path`,
        [fileId, user.id]
      );
      if (!rows[0]) throw new NotFoundError(FILE_NOT_FOUND);
      await unlinkInStore(rows[0].path);
    },

    async original(user: CurrentUser, fileId: string): Promise<{ absPath: string; originalName: string; contentType: string }> {
      const { rows } = await pg.query<{ path: string; original_name: string; content_type: string }>(
        `SELECT path, original_name, content_type FROM workspace.files
          WHERE id = $1 AND owner_id = $2 AND kind = 'upload'`,
        [fileId, user.id]
      );
      if (!rows[0]) throw new NotFoundError(FILE_NOT_FOUND);
      return { absPath: resolveInStore(rows[0].path), originalName: rows[0].original_name, contentType: rows[0].content_type };
    },
  };
}
