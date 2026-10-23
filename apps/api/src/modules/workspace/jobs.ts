import path from 'node:path';
import type { Pool } from 'pg';
import {
  CRS_OPTIONS, DEFAULT_CRS_ID, LAYER_GEOMETRY, shapefileFieldNames,
  type EditableLayerKey, type OgcGeometryType,
} from '@webatlas/shared';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import { getLayer } from '../../layers/registry';
import type { CurrentUser } from '../../types/fastify';
import { editCopyRowsArgs } from '../layers/repository';
import { MAP_NOT_FOUND, OWNER_ONLY, assertCanRead, mapRole, type Queryable } from './access';
import { resolveInStore } from './fileStore';
import { LAYER_NOT_FOUND } from './freeLayers';
import { FILE_NOT_FOUND } from './uploads';

/*
 * Import and export jobs. The API queues a row in workspace.jobs; the GDAL worker
 * (packages/atlas-data/tools/workspace/worker.py) claims it, runs it, and records its steps,
 * progress and result. `params` is the whole of what the worker is told: the file to read or the
 * layers to write, the CRS as proj4 (the worker keeps no CRS table of its own), the row limit.
 * It is a contract with the worker (ImportParams, ExportParams below) and never leaves the API:
 * the Job view a client sees has no params.
 *
 * Access: a job belongs to the user who queued it, and anyone else gets the same 404 as for a job
 * that does not exist. Queueing follows the map: only the owner imports into it (an import adds
 * layers), while the owner and every recipient may export it (an export only reads).
 */

export const JOB_NOT_FOUND = 'Không tìm thấy công việc.';
export const NOTHING_TO_EXPORT = 'Bản đồ không có lớp nào để xuất.';

/** The most rows an import may bring in, across all of the file's layers. */
export const IMPORT_MAX_ROWS = 200_000;
/** The newest jobs a list returns. */
export const JOB_LIST_LIMIT = 50;

export type JobKind = 'import' | 'export';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type ExportFormat = 'gpkg' | 'geojson' | 'shp';
type GeometryFamily = 'point' | 'line' | 'polygon';

export interface JobStep {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  message?: string;
}

/** What a client sees of a job. No params. */
export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  mapId: string | null;
  progress: number;
  steps: JobStep[];
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CrsParam { id: string; proj4: string }
type FieldNames = Array<{ from: string; to: string }>;

/** params of an import job. */
export interface ImportParams {
  fileId: string;
  path: string; // store-relative
  originalName: string;
  mapId: string;
  ownerId: string;
  maxRows: number;
  sourceCrs: CrsParam | null;
}

/** One layer of an export job. */
export interface ExportLayerParams {
  layerId: string;
  kind: 'free' | 'edit_copy';
  title: string;
  style: Record<string, unknown>;
  geometryType: GeometryFamily | null;
  /** A free layer's declared fields ([] for an imported layer); null for an edit copy. */
  fields: unknown[] | null;
  /** The arguments of workspace.edit_copy_rows for an edit copy; null for a free layer. */
  editCopy: { table: string; relation: string; draftId: string; geomColumn: string; columns: string[] } | null;
  /** The Shapefile field renames (shapefileFieldNames) for a shp export; null otherwise. */
  shpNames: FieldNames | null;
}

/** params of an export job. */
export interface ExportParams {
  mapId: string;
  ownerId: string;
  mapTitle: string;
  format: ExportFormat;
  crs: CrsParam;
  downloadName: string;
  layers: ExportLayerParams[];
}

/** The result a succeeded job records (written by the worker). */
export type ImportResult = { layerIds: string[]; rows: number };
export type ExportResult = { fileId: string };

const pending = (steps: Array<[string, string]>): JobStep[] =>
  steps.map(([key, label]) => ({ key, label, status: 'pending' }));

export const IMPORT_STEPS = pending([['read', 'Đọc tệp'], ['transform', 'Chuyển hệ toạ độ'], ['write', 'Ghi vào bản đồ']]);
export const EXPORT_STEPS = pending([['read', 'Đọc dữ liệu'], ['write', 'Ghi tệp'], ['package', 'Đóng gói']]);

const WARN_SHP_STYLE = 'Shapefile không giữ kiểu hiển thị.';
const WARN_SHP_SPLIT = 'Mỗi loại hình học được ghi thành một tệp riêng.';
const WARN_RASTER = 'Lớp ảnh không được xuất; tải ảnh riêng từ lớp đó.';
const WARN_GEOJSON_CRS = 'GeoJSON ngoài WGS 84 không theo chuẩn RFC 7946.';
const warnDraftGone = (title: string) => `Lớp "${title}" không còn bản nháp nên không được xuất.`;

const CONTENT_TYPES: Record<string, string> = {
  '.gpkg': 'application/geopackage+sqlite3',
  '.geojson': 'application/geo+json',
  '.zip': 'application/zip',
};

const FAMILY: Record<OgcGeometryType, GeometryFamily> = { Point: 'point', MultiLineString: 'line', MultiPolygon: 'polygon' };

/**
 * A CRS option by id. The schemas refuse unknown ids with 400 first; this is the second guard,
 * since findCrs would fall back to the first option instead of failing.
 */
function crsParam(id: string): CrsParam {
  const option = CRS_OPTIONS.find((o) => o.id === id);
  if (!option) throw new ValidationError('Validation failed', { fieldErrors: { crs: ['Unknown coordinate system'] } });
  return { id: option.id, proj4: option.proj4 };
}

/**
 * A file name from a map title: lower case, diacritics removed (đ → d), every run of characters
 * other than [a-z0-9] turned into one '-', no '-' at either end; 'ban-do' when nothing is left.
 */
export function titleSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'ban-do';
}

/** The export's file name: .gpkg, .zip for shp (always zipped) and for several GeoJSON layers. */
export function downloadNameFor(title: string, format: ExportFormat, layerCount: number): string {
  const ext = format === 'gpkg' ? 'gpkg' : format === 'geojson' && layerCount === 1 ? 'geojson' : 'zip';
  return `${titleSlug(title)}.${ext}`;
}

// --- Rows ---------------------------------------------------------------------------------

interface JobRow {
  id: string;
  kind: JobKind;
  status: JobStatus;
  map_id: string | null;
  progress: number;
  steps: JobStep[];
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

const JOB_COLS = 'id, kind, status, map_id, progress, steps, result, error, created_at, finished_at';

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    mapId: row.map_id,
    progress: row.progress,
    steps: row.steps,
    result: row.result,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

interface MapLayerRow {
  id: string;
  kind: 'free' | 'edit_copy' | 'raster' | 'annotation';
  title: string;
  style: Record<string, unknown>;
  geometryType: GeometryFamily | null;
  fields: Array<{ name: string }>;
  layerKey: string | null;
  draftId: string | null;
}
type ExportableRow = MapLayerRow & { kind: 'free' | 'edit_copy' };

interface ExportSelection {
  layers: ExportableRow[];
  rasterSkipped: boolean;
  /** Titles of the edit copies left out because their draft has been discarded. */
  draftsGone: string[];
}

/**
 * The layers an export writes, in map order: those named in `layerIds`, or every layer of the
 * map. Only free layers and edit copies are written. A raster layer among them is skipped and
 * reported, and so is an edit copy whose draft is gone (draft_id NULL): there is nothing left to
 * read. The reserved kinds are left out. A named layer that is not in the map is 404.
 */
async function exportLayers(
  q: Queryable, mapId: string, layerIds: string[] | undefined
): Promise<ExportSelection> {
  const { rows } = await q.query<MapLayerRow>(
    `SELECT id, kind, title, style, geometry_type AS "geometryType", fields,
            layer_key AS "layerKey", draft_id AS "draftId"
       FROM workspace.map_layers WHERE map_id = $1 ORDER BY position`,
    [mapId]
  );
  let selected = rows;
  if (layerIds) {
    const inMap = new Set(rows.map((r) => r.id));
    if (layerIds.some((id) => !inMap.has(id))) throw new NotFoundError(LAYER_NOT_FOUND);
    const named = new Set(layerIds);
    selected = rows.filter((r) => named.has(r.id));
  }
  const gone = (r: MapLayerRow) => r.kind === 'edit_copy' && r.draftId === null;
  return {
    layers: selected.filter((r): r is ExportableRow => (r.kind === 'free' || r.kind === 'edit_copy') && !gone(r)),
    rasterSkipped: selected.some((r) => r.kind === 'raster'),
    draftsGone: selected.filter(gone).map((r) => r.title),
  };
}

/** The warnings shown for an export, in the same order by the preview and on queueing. */
function exportWarnings(input: { format: ExportFormat }, crs: CrsParam, selection: ExportSelection): string[] {
  const warnings: string[] = [];
  if (input.format === 'shp') warnings.push(WARN_SHP_STYLE, WARN_SHP_SPLIT);
  if (selection.rasterSkipped) warnings.push(WARN_RASTER);
  for (const title of selection.draftsGone) warnings.push(warnDraftGone(title));
  if (input.format === 'geojson' && !isWgs84(crs)) warnings.push(WARN_GEOJSON_CRS);
  return warnings;
}

/**
 * The attribute names a layer's export writes. An edit copy: external_id and the registry's
 * attribute columns. A drawn free layer: its declared fields. A free layer that declares none
 * (an imported one): the keys its features carry, in order of first appearance.
 */
async function fieldNamesOf(q: Queryable, layer: ExportableRow): Promise<string[]> {
  if (layer.kind === 'edit_copy') return ['external_id', ...getLayer(layer.layerKey!).attributeColumns];
  if (layer.fields.length > 0) return layer.fields.map((f) => f.name);
  const { rows } = await q.query<{ key: string }>(
    `SELECT k.key
       FROM workspace.features f, jsonb_object_keys(f.properties) AS k(key)
      WHERE f.layer_id = $1
      GROUP BY k.key
      ORDER BY min(f.id), k.key`,
    [layer.id]
  );
  return rows.map((r) => r.key);
}

function geometryTypeOf(layer: ExportableRow): GeometryFamily | null {
  if (layer.kind === 'edit_copy') return FAMILY[LAYER_GEOMETRY[layer.layerKey as EditableLayerKey]];
  return layer.geometryType;
}

function isWgs84(crs: CrsParam): boolean {
  return crs.proj4 === crsParam(DEFAULT_CRS_ID).proj4;
}

async function insertJob(
  q: Queryable, ownerId: string, mapId: string, kind: JobKind, params: ImportParams | ExportParams, steps: JobStep[]
): Promise<Job> {
  const { rows } = await q.query<JobRow>(
    `INSERT INTO workspace.jobs (owner_id, map_id, kind, params, steps)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     RETURNING ${JOB_COLS}`,
    [ownerId, mapId, kind, JSON.stringify(params), JSON.stringify(steps)]
  );
  return toJob(rows[0]);
}

export interface ExportRequest { format: ExportFormat; crs: string; layerIds?: string[] }

export function jobsService(pg: Pool) {
  async function ownJob(user: CurrentUser, jobId: string): Promise<JobRow & { params: unknown }> {
    const { rows } = await pg.query<JobRow & { params: unknown }>(
      `SELECT ${JOB_COLS}, params FROM workspace.jobs WHERE id = $1 AND owner_id = $2`,
      [jobId, user.id]
    );
    if (!rows[0]) throw new NotFoundError(JOB_NOT_FOUND);
    return rows[0];
  }

  return {
    /**
     * Queue an import of one of the user's uploads into the map. Owner only. No revision check:
     * the job appends its layers and bumps the map's revision itself, and the client refreshes.
     */
    async enqueueImport(
      user: CurrentUser, mapId: string, input: { fileId: string; sourceCrs?: string | null }
    ): Promise<{ job: Job }> {
      const sourceCrs = input.sourceCrs ? crsParam(input.sourceCrs) : null;
      const role = await mapRole(pg, mapId, user.id);
      if (role === null) throw new NotFoundError(MAP_NOT_FOUND);
      if (role !== 'owner') throw new ForbiddenError(OWNER_ONLY);
      return inTransaction(pg, async (client) => {
        // An upload whose delete_after has passed is gone, whether or not the sweep has removed
        // it yet. The row lock keeps the sweep (cleanup.ts deleteExpiredFiles) from removing it
        // while the job is queued.
        const { rows } = await client.query<{ path: string; original_name: string }>(
          `SELECT path, original_name FROM workspace.files
            WHERE id = $1 AND owner_id = $2 AND kind = 'upload'
              AND (delete_after IS NULL OR delete_after > now())
            FOR UPDATE`,
          [input.fileId, user.id]
        );
        if (!rows[0]) throw new NotFoundError(FILE_NOT_FOUND);
        // An original kept for 90 days after its map was archived (cleanup.ts
        // markArchivedOriginals) is imported into a live map again: it no longer expires.
        await client.query(
          `UPDATE workspace.files SET delete_after = NULL WHERE id = $1 AND delete_after IS NOT NULL`,
          [input.fileId]
        );
        const params: ImportParams = {
          fileId: input.fileId,
          path: rows[0].path,
          originalName: rows[0].original_name,
          mapId,
          ownerId: user.id,
          maxRows: IMPORT_MAX_ROWS,
          sourceCrs,
        };
        return { job: await insertJob(client, user.id, mapId, 'import', params, IMPORT_STEPS) };
      });
    },

    /**
     * Queue an export of the map. The owner and every recipient may export; the job, and the
     * file it makes, belong to the user who asked. Returns the preview's warnings beside the job,
     * so a layer left out is reported even when the export was queued without a preview.
     */
    async enqueueExport(
      user: CurrentUser, mapId: string, input: ExportRequest
    ): Promise<{ job: Job; warnings: string[] }> {
      const crs = crsParam(input.crs);
      return inTransaction(pg, async (client) => {
        // One snapshot for the map's title, its layers and their field names.
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await assertCanRead(client, mapId, user);
        const { rows: maps } = await client.query<{ title: string }>(
          `SELECT title FROM workspace.maps WHERE id = $1`, [mapId]
        );
        if (!maps[0]) throw new NotFoundError(MAP_NOT_FOUND);
        const selection = await exportLayers(client, mapId, input.layerIds);
        const { layers } = selection;
        if (layers.length === 0) throw new ValidationError(NOTHING_TO_EXPORT);

        const out: ExportLayerParams[] = [];
        for (const layer of layers) {
          let editCopy: ExportLayerParams['editCopy'] = null;
          if (layer.kind === 'edit_copy') {
            const draftId = layer.draftId!; // exportLayers leaves out edit copies without a draft
            editCopy = { ...editCopyRowsArgs(getLayer(layer.layerKey!), draftId), draftId };
          }
          out.push({
            layerId: layer.id,
            kind: layer.kind,
            title: layer.title,
            style: layer.style,
            geometryType: geometryTypeOf(layer),
            fields: layer.kind === 'free' ? layer.fields : null,
            editCopy,
            shpNames: input.format === 'shp' ? shapefileFieldNames(await fieldNamesOf(client, layer)) : null,
          });
        }
        const params: ExportParams = {
          mapId,
          ownerId: user.id,
          mapTitle: maps[0].title,
          format: input.format,
          crs,
          downloadName: downloadNameFor(maps[0].title, input.format, out.length),
          layers: out,
        };
        const job = await insertJob(client, user.id, mapId, 'export', params, EXPORT_STEPS);
        return { job, warnings: exportWarnings(input, crs, selection) };
      });
    },

    /**
     * What an export would do, before it is queued: the layers it writes, the Shapefile field
     * names it would change (folded to ASCII or cut), and the warnings for the format and CRS
     * chosen.
     */
    async preview(user: CurrentUser, mapId: string, input: ExportRequest): Promise<{
      layers: Array<{ layerId: string; title: string; truncated: FieldNames }>;
      warnings: string[];
    }> {
      const crs = crsParam(input.crs);
      await assertCanRead(pg, mapId, user);
      const selection = await exportLayers(pg, mapId, input.layerIds);
      const out = [];
      for (const layer of selection.layers) {
        const truncated = input.format === 'shp'
          ? shapefileFieldNames(await fieldNamesOf(pg, layer)).filter((n) => n.from !== n.to)
          : [];
        out.push({ layerId: layer.id, title: layer.title, truncated });
      }
      return { layers: out, warnings: exportWarnings(input, crs, selection) };
    },

    async get(user: CurrentUser, jobId: string): Promise<Job> {
      return toJob(await ownJob(user, jobId));
    },

    /** The user's newest jobs, optionally for one map. A map id needs no access check: only the user's own jobs are listed. */
    async list(user: CurrentUser, opts: { mapId?: string } = {}): Promise<Job[]> {
      const { rows } = await pg.query<JobRow>(
        `SELECT ${JOB_COLS} FROM workspace.jobs
          WHERE owner_id = $1 AND ($2::uuid IS NULL OR map_id = $2)
          ORDER BY created_at DESC, id DESC
          LIMIT ${JOB_LIST_LIMIT}`,
        [user.id, opts.mapId ?? null]
      );
      return rows.map(toJob);
    },

    /**
     * The file of a succeeded export, while it has not expired. Anything else is 404: a job of
     * someone else's or none at all (JOB_NOT_FOUND), or one of the user's own that has no file
     * to give (FILE_NOT_FOUND).
     */
    async download(user: CurrentUser, jobId: string): Promise<{ absPath: string; downloadName: string; contentType: string }> {
      const job = await ownJob(user, jobId);
      const fileId = (job.result as Partial<ExportResult> | null)?.fileId;
      if (job.kind !== 'export' || job.status !== 'succeeded' || typeof fileId !== 'string') {
        throw new NotFoundError(FILE_NOT_FOUND);
      }
      const { rows } = await pg.query<{ path: string }>(
        `SELECT path FROM workspace.files
          WHERE id = $1 AND owner_id = $2 AND kind = 'export'
            AND (delete_after IS NULL OR delete_after > now())`,
        [fileId, user.id]
      );
      if (!rows[0]) throw new NotFoundError(FILE_NOT_FOUND);
      const { downloadName } = job.params as ExportParams;
      return {
        absPath: resolveInStore(rows[0].path),
        downloadName,
        contentType: CONTENT_TYPES[path.extname(downloadName).toLowerCase()] ?? 'application/octet-stream',
      };
    },
  };
}

export type JobsService = ReturnType<typeof jobsService>;
