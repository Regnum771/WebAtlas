import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMapContext } from '../../../app/providers/MapProvider';
import { ApiError } from '../../../shared/api/apiClient';
import * as api from '../api/workspace.api';
import type { Job, LayerSummary, MapDetail, PersonalFeature } from '../api/workspace.api';
import { uploadFile } from '../api/transfer';
import { expandMap, setLayerVisible } from './myMaps.store';
import { fitToExtent4326 } from './personalLayers';
import { keys, useJob, useMyMaps } from './queries';

export type UploadPhase = 'idle' | 'uploading' | 'queued' | 'running' | 'succeeded' | 'failed';
type Extent = [number, number, number, number];

/** The `Nhập vào` value that creates a map named after the file. */
export const NEW_MAP = 'new';
/** The `Hệ toạ độ nguồn` value that lets the worker read the CRS from the file. */
export const AUTO_CRS = '';
/** The API's per-file limit (apps/api workspace/uploads.ts MAX_UPLOAD_BYTES). */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const TOO_LARGE_COPY = 'Tệp lớn hơn 200 MB.';
/** The worker's job error for a file without a coordinate system. */
export const NO_CRS_ERROR = 'Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn.';

const WGS84_IDS = ['wgs84-dd', 'wgs84-dms'];
const WORLD: Extent = [-180, -90, 180, 90];
/** One read per new layer for the fit: an extent of its first 5000 features. */
const FIT_READ_LIMIT = 5000;
const TITLE_MAX = 200;

/** The file name without its extension (`Cống.geojson` → `Cống`), as a map title. */
function titleOf(name: string): string {
  const stem = name.replace(/\.[^.]*$/, '').trim();
  return (stem || name).slice(0, TITLE_MAX);
}

const isGeoJson = (name: string) => /\.(geojson|json)$/i.test(name);

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Chưa tải lên được. Thử lại.';
}

/** Grows `ext` with every [x, y] position nested in a GeoJSON coordinates array. */
function addCoordinates(ext: Extent | null, coords: unknown): Extent | null {
  if (!Array.isArray(coords)) return ext;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const [x, y] = coords as number[];
    return ext ? [Math.min(ext[0], x), Math.min(ext[1], y), Math.max(ext[2], x), Math.max(ext[3], y)] : [x, y, x, y];
  }
  return coords.reduce<Extent | null>((acc, c) => addCoordinates(acc, c), ext);
}

function featuresExtent(features: PersonalFeature[]): Extent | null {
  let ext: Extent | null = null;
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      for (const part of g.geometries as { coordinates?: unknown }[]) ext = addCoordinates(ext, part.coordinates);
    } else {
      ext = addCoordinates(ext, g.coordinates);
    }
  }
  return ext;
}

function union(a: Extent | null, b: Extent | null): Extent | null {
  if (!a || !b) return a ?? b;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function rasterExtent(layer: LayerSummary): Extent | null {
  const b = layer.raster?.bounds4326;
  return Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number') ? (b as Extent) : null;
}

/**
 * The upload dialog: pick a file, upload it with progress, queue an import into one of the
 * user's maps (or a new one), follow the job, and on success show its layers and fly to them.
 * A file without a coordinate system is imported again from the same upload with the chosen CRS.
 */
export function useUploadPresenter({ targetMapId }: { targetMapId: string | null }) {
  const qc = useQueryClient();
  const { map } = useMapContext();
  const maps = useMyMaps();

  const [file, setFileState] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [target, setTargetState] = useState<string>(targetMapId ?? NEW_MAP);
  const [sourceCrs, setSourceCrs] = useState<string>(AUTO_CRS);
  const [localPhase, setLocalPhase] = useState<'idle' | 'uploading' | 'queued' | 'failed'>('idle');
  const [progress, setProgress] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [crsRequired, setCrsRequired] = useState(false);
  /** A map this dialog created: listed in the select until the map list has refetched. */
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);

  /** Bumped by close() and by each new run: an older run's continuations stop. */
  const run = useRef(0);
  const abort = useRef<AbortController | null>(null);
  /** The map the file goes into, once known (a new map is created only once per file). */
  const mapIdRef = useRef<string | null>(null);
  const handled = useRef<string | null>(null);

  const jobQuery = useJob(jobId);
  const job: Job | null = jobId ? jobQuery.data ?? null : null;
  const phase: UploadPhase = job ? job.status : jobId ? 'queued' : localPhase;
  const error = job?.status === 'failed' ? job.error : job ? null : localError;

  /** Another file starts over: a new upload, a new target map, the CRS read from the file again. */
  function setFile(next: File | null) {
    setFileId(null);
    setCrsRequired(false);
    mapIdRef.current = null;
    setJobId(null);
    setLocalError(null);
    setLocalPhase('idle');
    setFileState(next);
    setFileError(next && next.size > MAX_UPLOAD_BYTES ? TOO_LARGE_COPY : null);
  }

  function setTarget(id: string) {
    mapIdRef.current = null;
    setTargetState(id);
  }

  async function queue(id: string, crs: string, token: number, name: string): Promise<void> {
    try {
      let mapId = mapIdRef.current;
      if (!mapId) {
        if (target === NEW_MAP) {
          const made = await api.createMap({ title: titleOf(name) });
          void qc.invalidateQueries({ queryKey: keys.maps });
          mapId = made.id;
          // The select now names the created map, so trying again (or another file) does not make a second one.
          setCreated({ id: made.id, title: made.title });
          setTargetState(mapId);
        } else {
          mapId = target;
        }
        mapIdRef.current = mapId;
      }
      if (token !== run.current) return;
      const res = await api.queueImport(mapId, crs === AUTO_CRS ? { fileId: id } : { fileId: id, sourceCrs: crs });
      if (token !== run.current) return;
      qc.setQueryData(keys.job(res.job.id), res.job);
      setJobId(res.job.id);
    } catch (e) {
      if (token !== run.current) return;
      setLocalError(messageOf(e));
      setLocalPhase('failed');
    }
  }

  async function submit(): Promise<void> {
    if (!file || fileError) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError(TOO_LARGE_COPY);
      return;
    }
    const token = ++run.current;
    setJobId(null);
    setLocalError(null);
    // This file is already on the server (its import failed to queue or to run): queue it again.
    if (fileId) {
      setLocalPhase('queued');
      await queue(fileId, sourceCrs, token, file.name);
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setProgress(0);
    setLocalPhase('uploading');
    let uploaded: api.Upload;
    try {
      uploaded = await uploadFile(file, (f) => {
        if (token === run.current) setProgress(Math.round(f * 100));
      }, controller.signal);
    } catch (e) {
      if (token !== run.current) return;
      abort.current = null;
      if (e instanceof ApiError && e.code === 'ABORTED') {
        setLocalPhase('idle');
      } else {
        setLocalError(messageOf(e));
        setLocalPhase('failed');
      }
      return;
    } finally {
      if (abort.current === controller) abort.current = null;
    }
    if (token !== run.current) return;
    setFileId(uploaded.id);
    setLocalPhase('queued');
    void qc.invalidateQueries({ queryKey: keys.uploads });
    await queue(uploaded.id, sourceCrs, token, file.name);
  }

  /** Queues the import again from the uploaded file, with the chosen coordinate system. */
  async function retry(crs: string): Promise<void> {
    if (!fileId || !file || (crsRequired && crs === AUTO_CRS)) return;
    const token = ++run.current;
    setJobId(null);
    setLocalError(null);
    setLocalPhase('queued');
    await queue(fileId, crs, token, file.name);
  }

  /** Aborts an upload in flight and stops following the job; the dialog starts over when opened again. */
  function close(): void {
    run.current++;
    abort.current?.abort();
    abort.current = null;
    setJobId(null);
    setLocalError(null);
    setProgress(0);
    setLocalPhase('idle');
  }

  // Leaving (the dialog unmounts, or the user signs out) aborts an upload still in flight.
  useEffect(() => () => {
    run.current++;
    abort.current?.abort();
  }, []);

  // A file without a coordinate system: from now on the CRS must be chosen for it.
  useEffect(() => {
    if (job?.status === 'failed' && job.error === NO_CRS_ERROR) setCrsRequired(true);
  }, [job?.status, job?.error]);

  // Once per succeeded job: open its map, turn the new layers on and fly to them.
  useEffect(() => {
    if (!job || job.status !== 'succeeded' || handled.current === job.id) return;
    handled.current = job.id;
    const mapId = job.mapId ?? mapIdRef.current;
    if (!mapId) return;
    const layerIds = Array.isArray(job.result?.layerIds) ? (job.result.layerIds as string[]) : [];
    expandMap(mapId);
    for (const id of layerIds) setLayerVisible(id, true);
    void qc.invalidateQueries({ queryKey: keys.maps });
    void qc.invalidateQueries({ queryKey: keys.uploads });
    void (async () => {
      try {
        const detail = await qc.fetchQuery<MapDetail>({ queryKey: keys.map(mapId), queryFn: () => api.getMap(mapId) });
        const layers = detail.layers.filter((l) => layerIds.includes(l.id));
        const extents = await Promise.all(layers.map(async (l): Promise<Extent | null> => {
          if (l.kind === 'raster') return rasterExtent(l);
          if (l.kind !== 'free') return null;
          const res = await api.listFeatures(mapId, l.id, { bbox: WORLD, limit: FIT_READ_LIMIT });
          return featuresExtent(res.features);
        }));
        const extent = extents.reduce<Extent | null>(union, null);
        if (extent && map) fitToExtent4326(map, extent);
      } catch {
        // The fit is a convenience: the layers are on the map either way.
      }
    })();
  }, [job, map, qc]);

  const rows = typeof job?.result?.rows === 'number' ? job.result.rows : 0;
  const targets = (maps.data?.mine ?? []).map((m) => ({ id: m.id, title: m.title }));
  if (created && !targets.some((t) => t.id === created.id)) targets.push(created);
  const busy = phase === 'uploading' || phase === 'queued' || phase === 'running';

  return {
    phase,
    progress,
    job,
    file,
    fileError,
    target,
    targets,
    sourceCrs,
    crsRequired,
    crsWarning: file !== null && isGeoJson(file.name) && sourceCrs !== AUTO_CRS && !WGS84_IDS.includes(sourceCrs),
    error,
    successText: phase === 'succeeded' ? `Đã nhập xong.${rows > 0 ? ` ${rows} đối tượng.` : ''}` : null,
    canSubmit: file !== null && fileError === null && !busy && phase !== 'succeeded',
    canRetry: phase === 'failed' && crsRequired && fileId !== null && sourceCrs !== AUTO_CRS,
    setFile,
    setTarget,
    setSourceCrs,
    submit,
    retry,
    close,
  };
}
