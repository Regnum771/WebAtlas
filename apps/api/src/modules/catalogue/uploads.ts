import path from 'node:path';
import type { Pool } from 'pg';
import { ConflictError, NotFoundError, QuotaExceededError, ValidationError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import type { CurrentUser } from '../../types/fastify';
import { insertJob, TIMESERIES_STEPS, type Job, type TimeseriesImportParams } from '../workspace/jobs';
import { FILE_NOT_FOUND, storeUpload, type Upload, type UploadPart } from '../workspace/uploads';

/*
 * Time-series uploads for the catalogue: up to 2 GiB per file, stored as workspace.files kind
 * 'upload' with purpose 'timeseries', which workspace.usage_bytes leaves out (so they never count
 * toward the personal quota). POST /timeseries then queues the worker's timeseries_import job.
 */

/** An upload not yet imported expires after this many days; the import clears the date. */
export const PENDING_DAYS = 3;
/** The most a user may hold in uploads not yet imported. */
export const PENDING_CAP_BYTES = 4 * 1024 * 1024 * 1024;
export const PENDING_CAP_MESSAGE = 'Các tệp chuỗi thời gian chưa đưa lên Danh mục không được vượt quá 4 GB; hãy đưa các tệp đã tải lên Danh mục hoặc xoá bớt.';
export const TIMESERIES_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** The times table of a GeoTIFF series: a small .csv beside the big files. */
export const TIMES_CSV_MAX_BYTES = 1024 * 1024;
export const TIMESERIES_EXTENSIONS: readonly string[] = ['.zip', '.tif', '.tiff', '.nc', '.hdf', '.csv'];
export const CSV_NOT_A_SERIES = 'Tệp CSV chỉ dùng làm bảng thời gian, không phải chuỗi dữ liệu.';
export const NOT_A_TIMES_CSV = 'Bảng thời gian phải là tệp CSV đã tải lên cho chuỗi thời gian.';

export const UNSUPPORTED_TIMESERIES = 'Định dạng chưa hỗ trợ cho chuỗi thời gian.';
export const TIMESERIES_TOO_LARGE = 'Tệp lớn hơn 2 GB.';
export const TIMES_CSV_TOO_LARGE = 'Tệp CSV lớn hơn 1 MB.';
export const NEEDS_SSO = 'Cần đăng nhập một lần (SSO) để đưa dữ liệu lên Danh mục.';

const SOURCE_BY_EXT: Record<string, TimeseriesImportParams['source']> = {
  '.tif': 'geotiff', '.tiff': 'geotiff', '.nc': 'netcdf', '.hdf': 'hecras',
};

export interface TimeseriesRequest {
  fileId: string;
  title: string;
  abstract?: string;
  timePattern?: string;
  timesCsvFileId?: string;
  hdfArea?: string;
  every: 1 | 4;
}

export function catalogueUploadsService(pg: Pool, opts: { maxBytes?: number; csvMaxBytes?: number; pendingCapBytes?: number } = {}) {
  const maxBytes = opts.maxBytes ?? TIMESERIES_MAX_BYTES;
  const csvMaxBytes = opts.csvMaxBytes ?? TIMES_CSV_MAX_BYTES;
  const pendingCapBytes = opts.pendingCapBytes ?? PENDING_CAP_BYTES;

  return {
    upload(user: CurrentUser, part: UploadPart): Promise<{ upload: Upload }> {
      return storeUpload(pg, user, part, {
        maxBytes,
        extensions: TIMESERIES_EXTENSIONS,
        purpose: 'timeseries',
        countsToQuota: false,
        unsupportedMessage: UNSUPPORTED_TIMESERIES,
        expiry: { deleteAfterDays: PENDING_DAYS, pendingCapBytes, overCap: () => new QuotaExceededError(PENDING_CAP_MESSAGE) },
        extensionMaxBytes: { '.csv': csvMaxBytes },
        tooLargeMessage: (ext) => (ext === '.csv' ? TIMES_CSV_TOO_LARGE : TIMESERIES_TOO_LARGE),
      });
    },

    /** Queue a timeseries_import job for one of the caller's time-series uploads. */
    async enqueue(user: CurrentUser, input: TimeseriesRequest): Promise<{ job: Job }> {
      // The job's owner is the Keycloak account that will own the GeoNode dataset.
      const sub = user.oidcSubject;
      if (!sub) throw new ConflictError(NEEDS_SSO);

      return inTransaction(pg, async (client) => {
        // The row is locked until the job is committed, as workspace imports do, so the cleanup
        // sweep leaves the file alone while a queued job reads it (cleanup.ts BEING_IMPORTED).
        const { rows } = await client.query<{ path: string; original_name: string }>(
          `SELECT path, original_name FROM workspace.files
            WHERE id = $1 AND owner_id = $2 AND kind = 'upload' AND purpose = 'timeseries'
              AND (delete_after IS NULL OR delete_after > now())
            FOR UPDATE`,
          [input.fileId, user.id]
        );
        if (!rows[0]) throw new NotFoundError(FILE_NOT_FOUND);
        const ext = path.extname(rows[0].original_name).toLowerCase();
        if (ext === '.csv') throw new ValidationError(CSV_NOT_A_SERIES);

        let timesCsvPath: string | null = null;
        if (input.timesCsvFileId) {
          // The times table is the caller's own time-series upload, and a .csv.
          const { rows: csv } = await client.query<{ path: string; original_name: string }>(
            `SELECT path, original_name FROM workspace.files
              WHERE id = $1 AND owner_id = $2 AND kind = 'upload' AND purpose = 'timeseries'
                AND (delete_after IS NULL OR delete_after > now())
              FOR UPDATE`,
            [input.timesCsvFileId, user.id]
          );
          if (!csv[0]) throw new NotFoundError(FILE_NOT_FOUND);
          if (path.extname(csv[0].original_name).toLowerCase() !== '.csv') throw new ValidationError(NOT_A_TIMES_CSV);
          timesCsvPath = csv[0].path;
        }

        const params: TimeseriesImportParams = {
          fileId: input.fileId,
          path: rows[0].path,
          originalName: rows[0].original_name,
          ownerId: user.id,
          owner: { sub, username: user.email, email: user.email },
          title: input.title,
          abstract: input.abstract ?? '',
          source: SOURCE_BY_EXT[ext] ?? null,
          timePattern: input.timePattern ?? null,
          timesCsvPath,
          hdfArea: input.hdfArea ?? null,
          every: input.every,
          clip4326: null,
        };
        return { job: await insertJob(client, user.id, null, 'timeseries_import', params, TIMESERIES_STEPS) };
      });
    },
  };
}
