import type { ReactNode } from 'react';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import { layerLabel } from '../model/useUnassignedPresenter';
import type { UnassignedFeature } from '../api/unassigned.api';
import { ui } from '../../../shared/ui/styles';

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
    <section data-slot="admin-section" aria-labelledby="chua-gan" className={ui.section}>
      <h2 id="chua-gan" className={ui.title}>Đơn vị chưa gán</h2>
      {loading && <Spinner label="Đang tải…" />}
      {failed && (
        <Message tone="error" title="Không tải được danh sách đối tượng."
          actions={<Button onClick={onRetry}>Thử lại</Button>} />
      )}
      {!loading && !failed && rows.length === 0 && (
        <Message title="Không còn đối tượng nào chưa gán đơn vị." />
      )}
      {!loading && !failed && rows.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead className={ui.thead}>
              <tr>
                <th scope="col" className={ui.th}>Lớp</th>
                <th scope="col" className={ui.th}>Tên</th>
                <th scope="col" className={ui.th}>Mã</th>
                <th scope="col" className={ui.th}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.layerKey}:${r.id}`} className={ui.tr}>
                  <td className={ui.td}>{layerLabel(r.layerKey)}</td>
                  <td className={ui.td}>{r.name ?? '(không tên)'}</td>
                  <td className={`${ui.td} font-num text-num text-ink-2`}>{r.externalId ?? ''}</td>
                  <td className={ui.td}><Button size="sm" onClick={() => onAssign(r)}>Gán đơn vị</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog}
    </section>
  );
}
