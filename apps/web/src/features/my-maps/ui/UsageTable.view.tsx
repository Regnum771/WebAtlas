import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import { formatBytes } from '../model/formatBytes';
import type { UsageRow } from '../model/useUsagePresenter';

interface Props {
  rows: UsageRow[];
  loading: boolean;
  error: string | null;
  editingId: string | null;
  draft: string;
  saving: boolean;
  saveError: string | null;
  canSave: boolean;
  onStartEdit: (userId: string) => void;
  onDraft: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRetry?: () => void;
}

/** Passive: per-user personal-map counts, usage and quota. Counts and sizes only, never content. */
export function UsageTableView(p: Props) {
  if (p.loading) return <Spinner label="Đang tải…" />;
  return (
    <div className="user-mgmt">
      {p.error && (
        <Message tone="error" title={p.error} actions={p.onRetry && <Button onClick={p.onRetry}>Thử lại</Button>} />
      )}
      <table className="user-table">
        <thead>
          <tr>
            <th scope="col">Người dùng</th>
            <th scope="col">Bản đồ</th>
            <th scope="col">Lớp</th>
            <th scope="col">Đối tượng</th>
            <th scope="col">Đã dùng</th>
            <th scope="col">Hạn mức</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => (
            <tr key={r.userId}>
              <td className="col-email">{r.email}</td>
              <td>{r.maps}</td>
              <td>{r.layers}</td>
              <td>{r.features}</td>
              <td>
                {formatBytes(r.usageBytes)}
                {r.overQuota && <> <span className="badge on">Vượt hạn mức</span></>}
              </td>
              <td>
                {p.editingId === r.userId ? (
                  <form onSubmit={(e) => { e.preventDefault(); p.onSave(); }}>
                    <input
                      type="text" inputMode="decimal" className="input" aria-label="Hạn mức (GB)"
                      value={p.draft} onChange={(e) => p.onDraft(e.target.value)}
                    />{' '}
                    <Button type="submit" variant="solid" size="sm" busy={p.saving} disabled={!p.canSave}>Lưu</Button>{' '}
                    <Button size="sm" onClick={p.onCancel}>Huỷ</Button>
                    {p.saveError && <p className="hint bad">{p.saveError}</p>}
                  </form>
                ) : (
                  <>
                    {formatBytes(r.quotaBytes)}{' '}
                    <Button size="sm" variant="quiet" onClick={() => p.onStartEdit(r.userId)}>Sửa</Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
