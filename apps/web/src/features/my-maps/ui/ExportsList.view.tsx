import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import type { Job } from '../api/workspace.api';
import { exportRowLabel } from '../model/useExportPresenter';

interface Props {
  /** The map's export jobs, newest first. */
  jobs: Job[];
  error: string | null;
  downloadingId: string | null;
  deletingId: string | null;
  onDownload: (jobId: string) => void;
  onDelete: (jobId: string) => void;
}

/** Passive: Tệp đã xuất — the map's export files with expiry, download and delete. */
export function ExportsListView({ jobs, error, downloadingId, deletingId, onDownload, onDelete }: Props) {
  return (
    <section className="exports-list" aria-labelledby="exports-title">
      <h3 id="exports-title" className="layers-group-title">Tệp đã xuất</h3>
      {error && <Message tone="error" title={error} />}
      {jobs.length === 0 ? (
        <p className="my-maps-empty">Chưa có tệp nào.</p>
      ) : (
        <ul className="exports-rows">
          {jobs.map((job) => (
            <li key={job.id} className="exports-row">
              <span>{exportRowLabel(job)}</span>
              {job.status === 'failed' && job.error && <p className="hint bad">{job.error}</p>}
              <span className="exports-row-actions">
                {job.status === 'succeeded' && (
                  <Button size="sm" busy={downloadingId === job.id} onClick={() => onDownload(job.id)}>Tải</Button>
                )}
                <Button size="sm" variant="danger" busy={deletingId === job.id} onClick={() => onDelete(job.id)}>Xoá</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
