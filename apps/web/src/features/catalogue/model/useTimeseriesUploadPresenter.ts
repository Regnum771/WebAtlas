import { useEffect, useRef, useState } from 'react';
import {
  createTimeseries, getCatalogueItem, uploadCatalogueFile, type TimePattern, type TimeseriesInput,
} from '../api/catalogue.api';
import { useJob } from '../../my-maps/model/queries';
import { addCatalogueLayer } from './catalogue.store';

/** The pattern select's value for "times come from an uploaded CSV". */
export const CSV_PATTERN = 'csv';
export type PatternChoice = TimePattern | typeof CSV_PATTERN;

export const PATTERN_OPTIONS: { value: PatternChoice; label: string }[] = [
  { value: 'YYYYMMDD', label: 'Ngày (YYYYMMDD)' },
  { value: 'YYYYMMDDHHmm', label: 'Ngày giờ (YYYYMMDDHHmm)' },
  { value: 'YYYYDDD', label: 'Ngày thứ trong năm (YYYYDDD)' },
  { value: CSV_PATTERN, label: 'Tệp CSV thời điểm' },
];

const extOf = (f: File | null) => (f ? /\.[^.]*$/.exec(f.name.toLowerCase())?.[0] ?? '' : '');

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Chưa tải lên được. Thử lại.';
}

/**
 * The time-series upload dialog: file + title + options, upload (a CSV of times first when chosen),
 * queue the job, follow it, and on success put the new entry on the map as a layer.
 */
export function useTimeseriesUploadPresenter() {
  const [file, setFileState] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [abstract, setAbstract] = useState('');
  const [pattern, setPattern] = useState<PatternChoice>('YYYYMMDD');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [area, setArea] = useState('');
  const [fifteen, setFifteen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef<string | null>(null);
  const run = useRef(0);

  const ext = extOf(file);
  const showPattern = ext === '.zip' || ext === '.tif' || ext === '.tiff';
  const showArea = ext === '.hdf';

  const job = useJob(jobId).data ?? null;
  const jobError = job?.status === 'failed' ? job.error ?? 'Xử lý không thành công.' : null;
  const busy = uploading || (jobId !== null && (!job || job.status === 'queued' || job.status === 'running'));

  useEffect(() => () => { run.current++; }, []);

  // Once per succeeded job: read the new entry and put it on the map.
  useEffect(() => {
    if (!job || job.status !== 'succeeded' || handled.current === job.id) return;
    handled.current = job.id;
    const id = job.result?.resourceId;
    if (typeof id !== 'string') return;
    getCatalogueItem(id).then(addCatalogueLayer, () => setError('Đã xử lý xong nhưng chưa mở được mục trong Danh mục.'));
  }, [job]);

  function setFile(next: File | null) {
    setFileState(next);
    setError(null);
    setJobId(null);
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
    try {
      const uploaded = await uploadCatalogueFile(file);
      const body: TimeseriesInput = { fileId: uploaded.id, title: title.trim() };
      if (abstract.trim()) body.abstract = abstract.trim();
      if (showPattern) {
        if (pattern === CSV_PATTERN && csvFile) body.timesCsvFileId = (await uploadCatalogueFile(csvFile)).id;
        else if (pattern !== CSV_PATTERN) body.timePattern = pattern;
      }
      if (showArea) {
        if (area.trim()) body.hdfArea = area.trim();
        body.every = fifteen ? 1 : 4;
      }
      const res = await createTimeseries(body);
      if (token !== run.current) return;
      setJobId(res.job.id);
    } catch (e) {
      if (token === run.current) setError(messageOf(e));
    } finally {
      if (token === run.current) setUploading(false);
    }
  }

  return {
    file, title, titleError, abstract, pattern, csvFile, area, fifteen,
    showPattern, showArea, busy, job,
    succeeded: job?.status === 'succeeded',
    error: error ?? jobError,
    setFile,
    setTitle: (v: string) => { setTitle(v); setTitleError(null); },
    setAbstract, setPattern, setCsvFile, setArea, setFifteen,
    submit,
  };
}
