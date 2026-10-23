import { CRS_OPTIONS } from '@webatlas/shared';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import type { ExportFormat, ExportPreview, Job } from '../api/workspace.api';
import { EXPORT_FORMATS } from '../model/useExportPresenter';
import { ExportsListView } from './ExportsList.view';
import { JobProgressView } from './JobProgress.view';

export interface ExportDialogViewProps {
  loading: boolean;
  format: ExportFormat;
  crs: string;
  layers: { id: string; title: string; checked: boolean }[];
  preview: ExportPreview | null;
  previewError: string | null;
  warnings: string[];
  job: Job | null;
  error: string | null;
  queueing: boolean;
  canSubmit: boolean;
  files: Job[];
  listError: string | null;
  downloadingId: string | null;
  deletingId: string | null;
  onFormat: (format: ExportFormat) => void;
  onCrs: (id: string) => void;
  onLayer: (layerId: string, checked: boolean) => void;
  onSubmit: () => void;
  onDownload: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onClose: () => void;
}

/** Passive: the Tải xuống bản đồ dialog — options, the live preview, the job's progress and the file list. */
export function ExportDialogView(p: ExportDialogViewProps) {
  const cuts = (p.preview?.layers ?? []).flatMap((l) => l.truncated.map((t) => ({ layer: l.title, ...t })));
  const noLayers = !p.loading && !p.layers.some((l) => l.checked);
  return (
    <Dialog open title="Tải xuống bản đồ" onClose={p.onClose}>
      {p.loading ? <Spinner /> : (
        <form className="form-stack" onSubmit={(e) => { e.preventDefault(); p.onSubmit(); }}>
          <div className="field">
            <label htmlFor="export-format">Định dạng</label>
            <select id="export-format" className="input" value={p.format}
              onChange={(e) => p.onFormat(e.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="export-crs">Hệ toạ độ</label>
            <select id="export-crs" className="input" value={p.crs} onChange={(e) => p.onCrs(e.target.value)}>
              {CRS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.alias}</option>)}
            </select>
          </div>
          <fieldset className="field">
            <legend>Lớp</legend>
            {p.layers.map((l) => (
              <label key={l.id} className="check-row">
                <input type="checkbox" checked={l.checked} onChange={(e) => p.onLayer(l.id, e.target.checked)} />
                {l.title}
              </label>
            ))}
          </fieldset>

          {noLayers && <p className="my-maps-empty">Không có lớp nào để xuất.</p>}
          {p.previewError && <Message tone="error" title={p.previewError} />}
          {cuts.length > 0 && (
            <section aria-labelledby="export-cuts-title">
              <h3 id="export-cuts-title" className="layers-group-title">Tên trường sẽ đổi</h3>
              <table className="export-cuts">
                <thead><tr><th>Lớp</th><th>Tên cũ</th><th>Tên mới</th></tr></thead>
                <tbody>
                  {cuts.map((c, i) => <tr key={i}><td>{c.layer}</td><td>{c.from}</td><td>{c.to}</td></tr>)}
                </tbody>
              </table>
            </section>
          )}
          {p.warnings.length > 0 && (
            <ul className="export-warnings">{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}

          {p.job && <JobProgressView job={p.job} />}
          {p.error && <Message tone="error" title={p.error} />}

          <div className="dialog-actions">
            <Button onClick={p.onClose}>Đóng</Button>
            {p.job?.status === 'succeeded' && (
              <Button variant="solid" busy={p.downloadingId === p.job.id} onClick={() => p.onDownload(p.job!.id)}>Tải tệp</Button>
            )}
            <Button type="submit" variant="solid" busy={p.queueing} disabled={!p.canSubmit && !p.queueing}>Xuất</Button>
          </div>

          <ExportsListView
            jobs={p.files} error={p.listError} downloadingId={p.downloadingId} deletingId={p.deletingId}
            onDownload={p.onDownload} onDelete={p.onDelete}
          />
        </form>
      )}
    </Dialog>
  );
}
