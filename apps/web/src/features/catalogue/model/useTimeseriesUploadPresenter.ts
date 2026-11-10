import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../shared/api/apiClient';
import {
  createTimeseries, getCatalogueItem, uploadCatalogueFile, type Clip4326, type HdfTimeZone, type TimePattern,
  type TimeseriesInput,
} from '../api/catalogue.api';
import { useJob } from '../../my-maps/model/queries';
import { addCatalogueLayer } from './catalogue.store';
import { followTimeseriesJob } from './timeseriesJobFollower';

/** The pattern select's value for "times come from an uploaded CSV". */
export const CSV_PATTERN = 'csv';
export type PatternChoice = TimePattern | typeof CSV_PATTERN;

export const PATTERN_OPTIONS: { value: PatternChoice; label: string }[] = [
  { value: 'YYYYMMDD', label: 'Ngày (YYYYMMDD)' },
  { value: 'YYYYMMDDHHmm', label: 'Ngày giờ (YYYYMMDDHHmm)' },
  { value: 'YYYYDDD', label: 'Ngày thứ trong năm (YYYYDDD)' },
  { value: CSV_PATTERN, label: 'Tệp CSV thời điểm' },
];

/** The clock of a .hdf's time stamps; Vietnam's by default (a local modelling team's clock). */
export const HDF_TIME_ZONE_OPTIONS: { value: HdfTimeZone; label: string }[] = [
  { value: 'Asia/Ho_Chi_Minh', label: 'Giờ Việt Nam (UTC+7)' },
  { value: 'UTC', label: 'UTC' },
];

const extOf = (f: File | null) => (f ? /\.[^.]*$/.exec(f.name.toLowerCase())?.[0] ?? '' : '');

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Chưa tải lên được. Thử lại.';
}

export interface TimeseriesUploadOptions {
  /** The map's current view in EPSG:4326 (null: no map yet), read when the form is sent. */
  viewExtent4326?: () => Clip4326 | null;
}

/**
 * The time-series upload dialog: file + title + options, upload (a CSV of times first when chosen),
 * queue the job, follow it, and on success put the new entry on the map as a layer.
 *
 * A retry with the same File selected reuses the file already uploaded (a failed attempt's upload
 * stays pending on the server, and re-sending a 2 GB file would also fill the 4 GB pending cap).
 * Closing the dialog aborts an upload in flight; a job already queued is followed on after the
 * dialog closed (timeseriesJobFollower) and its entry still goes on the map.
 */
export function useTimeseriesUploadPresenter({ viewExtent4326 }: TimeseriesUploadOptions = {}) {
  const [file, setFileState] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [abstract, setAbstract] = useState('');
  const [pattern, setPattern] = useState<PatternChoice>('YYYYMMDD');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [area, setArea] = useState('');
  const [fifteen, setFifteen] = useState(false);
  const [clip, setClip] = useState(true);
  const [hdfTimeZone, setHdfTimeZone] = useState<HdfTimeZone>('Asia/Ho_Chi_Minh');
  const [uploading, setUploading] = useState(false);
  const [added, setAdded] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef<string | null>(null);
  const run = useRef(0);
  const mounted = useRef(true);
  const uploadAbort = useRef<AbortController | null>(null);
  // The files already on the server, by the File object they came from.
  const uploaded = useRef<{ file: File; id: string } | null>(null);
  const uploadedCsv = useRef<{ file: File; id: string } | null>(null);

  const ext = extOf(file);
  const showPattern = ext === '.zip' || ext === '.tif' || ext === '.tiff';
  const showArea = ext === '.hdf';
  // A zip may hold NetCDF grids; the worker cuts only those.
  const showClip = ext === '.nc' || ext === '.zip';

  const job = useJob(jobId).data ?? null;
  const jobError = job?.status === 'failed' ? job.error ?? 'Xử lý không thành công.' : null;
  const busy = uploading || (jobId !== null && (!job || job.status === 'queued' || job.status === 'running'));

  // Read by the unmount clean-up, which only sees the first render's values otherwise.
  const live = useRef({ jobId, job });
  live.current = { jobId, job };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      run.current++;
      uploadAbort.current?.abort();
      const { jobId: id, job: last } = live.current;
      if (id !== null && (!last || last.status === 'queued' || last.status === 'running')) followTimeseriesJob(id);
    };
  }, []);

  // Once per succeeded job: read the new entry and put it on the map.
  useEffect(() => {
    if (!job || job.status !== 'succeeded' || handled.current === job.id) return;
    handled.current = job.id;
    const id = job.result?.resourceId;
    if (typeof id !== 'string') return;
    getCatalogueItem(id).then((item) => { addCatalogueLayer(item); setAdded(true); }, () => setError('Đã xử lý xong nhưng chưa mở được mục trong Danh mục.'));
  }, [job]);

  function setFile(next: File | null) {
    setFileState(next);
    setError(null);
    setJobId(null);
    setAdded(false);
  }

  async function idOf(cache: typeof uploaded, f: File, signal: AbortSignal): Promise<string> {
    if (cache.current?.file === f) return cache.current.id;
    const { id } = await uploadCatalogueFile(f, signal);
    cache.current = { file: f, id };
    return id;
  }

  async function submit(): Promise<void> {
    if (!file || busy) return;
    if (!title.trim()) {
      setTitleError('Nhập tiêu đề.');
      return;
    }
    if (showPattern && pattern === CSV_PATTERN && !csvFile) {
      setError('Chọn tệp CSV thời điểm.');
      return;
    }
    const token = ++run.current;
    setTitleError(null);
    setError(null);
    setJobId(null);
    setUploading(true);
    const abort = new AbortController();
    uploadAbort.current = abort;
    try {
      const body: TimeseriesInput = { fileId: await idOf(uploaded, file, abort.signal), title: title.trim() };
      if (abstract.trim()) body.abstract = abstract.trim();
      if (showPattern) {
        if (pattern === CSV_PATTERN && csvFile) body.timesCsvFileId = await idOf(uploadedCsv, csvFile, abort.signal);
        else if (pattern !== CSV_PATTERN) body.timePattern = pattern;
      }
      if (showArea) {
        if (area.trim()) body.hdfArea = area.trim();
        body.every = fifteen ? 1 : 4;
        body.hdfTimeZone = hdfTimeZone;
      }
      if (showClip && clip) {
        const extent = viewExtent4326?.() ?? null;
        if (extent) body.clip4326 = extent;
      }
      uploadAbort.current = null;
      let res;
      try {
        res = await createTimeseries(body);
      } catch (e) {
        // The upload is gone (expired or deleted): the next try sends the file again.
        if (e instanceof ApiError && e.status === 404) uploaded.current = uploadedCsv.current = null;
        throw e;
      }
      // Closed while the job was being queued: it is followed on without the dialog.
      if (!mounted.current) { followTimeseriesJob(res.job.id); return; }
      if (token !== run.current) return;
      setJobId(res.job.id);
    } catch (e) {
      if (token === run.current) setError(messageOf(e));
    } finally {
      if (uploadAbort.current === abort) uploadAbort.current = null;
      if (token === run.current) setUploading(false);
    }
  }

  return {
    file, title, titleError, abstract, pattern, csvFile, area, fifteen, clip, hdfTimeZone,
    showPattern, showArea, showClip, busy, job,
    succeeded: added,
    error: error ?? jobError,
    setFile,
    setTitle: (v: string) => { setTitle(v); setTitleError(null); },
    setAbstract, setPattern, setCsvFile, setArea, setFifteen, setClip, setHdfTimeZone,
    submit,
  };
}
