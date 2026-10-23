import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as api from '../api/workspace.api';
import type { ExportFormat, ExportPreview, Job } from '../api/workspace.api';
import { downloadJobFile, saveBlob } from '../api/transfer';
import { keys, useJob, useMapDetail, useMapJobs } from './queries';

export const DEFAULT_EXPORT_CRS = 'wgs84-dd';
export const PREVIEW_DEBOUNCE_MS = 300;
/** Exported files are kept for this many days after they finish. */
export const EXPORT_KEEP_DAYS = 7;

export const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'gpkg', label: 'GeoPackage (.gpkg)' },
  { id: 'geojson', label: 'GeoJSON' },
  { id: 'shp', label: 'Shapefile nén (.zip)' },
];

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Chưa thực hiện được. Thử lại.';
}

/** `Xuất lúc {time} · hết hạn {date}` for a finished export; unfinished ones carry the time only. */
export function exportRowLabel(job: Job): string {
  const at = new Date(job.finishedAt ?? job.createdAt);
  const time = `Xuất lúc ${at.toLocaleString('vi-VN')}`;
  if (!job.finishedAt) return time;
  const expires = new Date(at.getTime() + EXPORT_KEEP_DAYS * 24 * 60 * 60 * 1000);
  return `${time} · hết hạn ${expires.toLocaleDateString('vi-VN')}`;
}

/**
 * The Tải xuống dialog of one map: format, coordinate system and layers; a debounced preview of the
 * Shapefile name cuts and the API's warnings; the export job with its progress; and the map's files.
 */
export function useExportPresenter({ mapId }: { mapId: string }) {
  const qc = useQueryClient();
  const detail = useMapDetail(mapId);
  const jobsQuery = useMapJobs(mapId);

  const [format, setFormat] = useState<ExportFormat>('gpkg');
  const [crs, setCrs] = useState(DEFAULT_EXPORT_CRS);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [queued, setQueued] = useState<string[] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const handled = useRef<string | null>(null);

  // Rasters have no export; the rest follow the map's order.
  const layers = [...(detail.data?.layers ?? [])]
    .filter((l) => l.kind !== 'raster')
    .sort((a, b) => a.position - b.position)
    .map((l) => ({ id: l.id, title: l.title, checked: !unchecked.has(l.id) }));
  const selected = layers.filter((l) => l.checked).map((l) => l.id);
  const selectedKey = selected.join(',');
  const loaded = detail.data !== undefined;

  // The preview follows the options, 300 ms after the last change.
  useEffect(() => {
    if (!loaded || selected.length === 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api.previewExport(mapId, { format, crs, layerIds: selected }).then(
        (p) => { if (live) { setPreview(p); setPreviewError(null); } },
        (e) => { if (live) { setPreview(null); setPreviewError(messageOf(e)); } },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
    // `selected` is derived from selectedKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, format, crs, selectedKey, loaded]);

  const jobQuery = useJob(jobId);
  const job: Job | null = jobId ? jobQuery.data ?? null : null;

  // Once per finished export: its file joins the list.
  useEffect(() => {
    if (!job || (job.status !== 'succeeded' && job.status !== 'failed') || handled.current === job.id) return;
    handled.current = job.id;
    void qc.invalidateQueries({ queryKey: keys.jobs(mapId) });
    void qc.invalidateQueries({ queryKey: keys.uploads });
  }, [job, mapId, qc]);

  function toggleLayer(id: string, checked: boolean) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (selected.length === 0 || queueing) return;
    setQueueing(true);
    setError(null);
    setJobId(null);
    setQueued(null);
    try {
      const res = await api.queueExport(mapId, { format, crs, layerIds: selected });
      qc.setQueryData(keys.job(res.job.id), res.job);
      setQueued(res.warnings);
      setJobId(res.job.id);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setQueueing(false);
    }
  }

  /** Fetches the file with the login token: a plain link could not send it. */
  async function download(id: string): Promise<void> {
    setDownloading(id);
    setListError(null);
    try {
      const file = await downloadJobFile(id);
      saveBlob(file.blob, file.filename);
    } catch (e) {
      setListError(messageOf(e));
    } finally {
      setDownloading(null);
    }
  }

  async function remove(id: string): Promise<void> {
    setDeleting(id);
    setListError(null);
    try {
      await api.deleteJob(id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.jobs(mapId) }),
        qc.invalidateQueries({ queryKey: keys.uploads }),
      ]);
      if (jobId === id) setJobId(null);
    } catch (e) {
      setListError(messageOf(e));
    } finally {
      setDeleting(null);
    }
  }

  const files = (jobsQuery.data ?? [])
    .filter((j) => j.kind === 'export')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = job !== null && (job.status === 'queued' || job.status === 'running');

  return {
    format, crs, layers, loading: !loaded && !detail.isError,
    preview: previewError ? null : preview,
    previewError,
    warnings: queued ?? preview?.warnings ?? [],
    job,
    error: error ?? (job?.status === 'failed' ? job.error : null),
    queueing, active,
    canSubmit: selected.length > 0 && !queueing && !active,
    files, listError, downloading, deleting,
    setFormat, setCrs, toggleLayer, submit, download, remove,
  };
}
