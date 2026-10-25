import { Link } from 'react-router-dom';
import { CRS_OPTIONS } from '@webatlas/shared';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Message } from '../../../shared/ui/Message';
import type { Job } from '../api/workspace.api';
import { AUTO_CRS, NEW_MAP, type UploadPhase } from '../model/useUploadPresenter';
import { JobProgressView } from './JobProgress.view';

export interface UploadDialogViewProps {
  phase: UploadPhase;
  /** Upload progress, 0–100. */
  progress: number;
  job: Job | null;
  /** The chosen file's name; null before one is chosen. */
  fileName: string | null;
  fileError: string | null;
  /** NEW_MAP or one of `targets`. */
  target: string;
  targets: { id: string; title: string }[];
  /** AUTO_CRS or a CRS_OPTIONS id. */
  sourceCrs: string;
  /** The file has no coordinate system: `Theo tệp` is gone and a choice is required. */
  crsRequired: boolean;
  crsWarning: boolean;
  error: string | null;
  successText: string | null;
  canSubmit: boolean;
  canRetry: boolean;
  onFile: (file: File | null) => void;
  onTarget: (id: string) => void;
  onSourceCrs: (id: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onClose: () => void;
}

const HINT = 'GeoPackage, GeoJSON, Shapefile nén (.zip), KML hoặc GeoTIFF; tối đa 200 MB.';
const ACCEPT = '.gpkg,.geojson,.json,.zip,.kml,.tif,.tiff';
const GEOJSON_WARNING = 'Tệp GeoJSON thường đã ở WGS 84. Chỉ chọn hệ khác nếu chắc chắn toạ độ trong tệp là toạ độ phẳng.';

/** Passive: the Tải tệp lên dialog — the file, where it goes, its coordinate system, and the job's progress. */
export function UploadDialogView(p: UploadDialogViewProps) {
  const working = p.phase === 'uploading' || p.phase === 'queued' || p.phase === 'running';
  const locked = working || p.phase === 'succeeded';
  const retrying = p.phase === 'failed' && p.crsRequired;
  // Once a job exists on the server, closing no longer cancels anything.
  const closeLabel = p.phase === 'queued' || p.phase === 'running' || p.phase === 'succeeded' ? 'Đóng' : 'Huỷ';

  return (
    <Dialog open title="Tải tệp lên" onClose={p.onClose}>
      <form
        className="form-stack upload-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (retrying) p.onRetry();
          else p.onSubmit();
        }}
      >
        <div className="field">
          {/* The native input is hidden (its button text follows the browser's language) but stays
              focusable and labelled; the label, drawn as a button, opens the picker. */}
          <div className="file-pick">
            <input
              id="upload-file"
              type="file"
              className="visually-hidden"
              accept={ACCEPT}
              disabled={locked}
              aria-invalid={p.fileError ? true : undefined}
              aria-describedby={`upload-file-name ${p.fileError ? 'upload-file-error' : 'upload-file-hint'}`}
              onChange={(e) => p.onFile(e.target.files?.[0] ?? null)}
            />
            <label htmlFor="upload-file" className={locked ? 'btn sm file-pick-button disabled' : 'btn sm file-pick-button'}>
              Chọn tệp
            </label>
            <span id="upload-file-name" className="file-pick-name">{p.fileName ?? 'Chưa chọn tệp.'}</span>
          </div>
          <p id="upload-file-hint" className="hint">{HINT}</p>
          {p.fileError && <p id="upload-file-error" className="hint bad" role="alert">{p.fileError}</p>}
        </div>

        <div className="field">
          <label htmlFor="upload-target">Nhập vào</label>
          <select id="upload-target" className="input" value={p.target} disabled={locked}
            onChange={(e) => p.onTarget(e.target.value)}>
            <option value={NEW_MAP}>Bản đồ mới</option>
            {p.targets.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="upload-crs">Hệ toạ độ nguồn</label>
          <select id="upload-crs" className="input" value={p.sourceCrs} disabled={locked} required={p.crsRequired}
            aria-invalid={p.crsRequired && p.sourceCrs === AUTO_CRS ? true : undefined}
            onChange={(e) => p.onSourceCrs(e.target.value)}>
            {p.crsRequired
              // An empty placeholder: nothing is chosen until the user picks a system.
              ? <option value={AUTO_CRS} disabled hidden />
              : <option value={AUTO_CRS}>Theo tệp (tự nhận)</option>}
            {CRS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.alias}</option>)}
          </select>
        </div>

        {p.crsWarning && <Message tone="caution" title={GEOJSON_WARNING} />}

        {p.phase === 'uploading' && (
          <div className="upload-progress">
            <progress max={100} value={p.progress} aria-label="Tiến độ" />
            <p role="status">{`Đang tải lên… ${p.progress}%`}</p>
          </div>
        )}
        {p.job && <JobProgressView job={p.job} />}
        {p.error && <Message tone="error" title={p.error} />}
        {p.successText && <Message tone="success" title={p.successText} />}

        {/* Following the link closes the dialog (it is portaled over the page); not offered mid-upload, where closing cancels. */}
        {!working && (
          <Link className="link" to="/du-lieu" onClick={p.onClose}>Cấu trúc các lớp chính thức →</Link>
        )}

        <div className="dialog-actions">
          <Button onClick={p.onClose}>{closeLabel}</Button>
          {retrying ? (
            <Button type="submit" variant="solid" disabled={!p.canRetry}>Nhập lại</Button>
          ) : !locked || p.phase === 'uploading' ? (
            <Button type="submit" variant="solid" busy={p.phase === 'uploading'} disabled={!p.canSubmit && p.phase !== 'uploading'}>
              Tải lên và nhập
            </Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
