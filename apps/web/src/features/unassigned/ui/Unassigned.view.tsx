import type { ReactNode } from 'react';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import { layerLabel } from '../model/useUnassignedPresenter';
import type { UnassignedFeature } from '../api/unassigned.api';

/** Passive: the table of features without a managing unit, with its loading, error and empty states. */
export function UnassignedView({ rows, loading, failed, onRetry, onAssign, dialog }: {
  rows: UnassignedFeature[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onAssign: (row: UnassignedFeature) => void;
  dialog: ReactNode;
}) {
  return (
    <section className="quan-ly-section">
      <h2>Đơn vị chưa gán</h2>
      {loading && <Spinner label="Đang tải…" />}
      {failed && (
        <Message tone="error" title="Không tải được danh sách đối tượng."
          actions={<Button onClick={onRetry}>Thử lại</Button>} />
      )}
      {!loading && !failed && rows.length === 0 && (
        <Message title="Không còn đối tượng nào chưa gán đơn vị." />
      )}
      {!loading && !failed && rows.length > 0 && (
        <table className="user-table">
          <thead>
            <tr><th>Lớp</th><th>Tên</th><th>Mã</th><th>Thao tác</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.layerKey}:${r.id}`}>
                <td>{layerLabel(r.layerKey)}</td>
                <td>{r.name ?? '(không tên)'}</td>
                <td>{r.externalId ?? ''}</td>
                <td><Button size="sm" onClick={() => onAssign(r)}>Gán đơn vị</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dialog}
    </section>
  );
}
