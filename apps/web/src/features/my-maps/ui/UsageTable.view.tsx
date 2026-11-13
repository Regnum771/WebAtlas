import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import { formatBytes } from '../model/formatBytes';
import type { UsageRow } from '../model/useUsagePresenter';
import { ui } from '../../../shared/ui/styles';

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
    <div className="flex flex-col gap-3">
      {p.error && (
        <Message tone="error" title={p.error} actions={p.onRetry && <Button onClick={p.onRetry}>Thử lại</Button>} />
      )}
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead className={ui.thead}>
            <tr>
              <th scope="col" className={ui.th}>Người dùng</th>
              <th scope="col" className={`${ui.th} text-right`}>Bản đồ</th>
              <th scope="col" className={`${ui.th} text-right`}>Lớp</th>
              <th scope="col" className={`${ui.th} text-right`}>Đối tượng</th>
              <th scope="col" className={ui.th}>Đã dùng</th>
              <th scope="col" className={ui.th}>Hạn mức</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.userId} className={ui.tr}>
                <td className={`${ui.td} [overflow-wrap:anywhere]`}>{r.email}</td>
                <td className={`${ui.td} text-right font-num text-num`}>{r.maps}</td>
                <td className={`${ui.td} text-right font-num text-num`}>{r.layers}</td>
                <td className={`${ui.td} text-right font-num text-num`}>{r.features}</td>
                <td className={ui.td}>
                  <span className="font-num text-num">{formatBytes(r.usageBytes)}</span>
                  {r.overQuota && <> <span className={ui.tagAlert}>Vượt hạn mức</span></>}
                </td>
                <td className={ui.td}>
                  {p.editingId === r.userId ? (
                    <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); p.onSave(); }}>
                      <input
                        type="text" inputMode="decimal" aria-label="Hạn mức (GB)"
                        value={p.draft} onChange={(e) => p.onDraft(e.target.value)}
                        className="h-control-sm w-20 rounded-md border border-ink-2 bg-surface px-2 font-num text-num"
                      />
                      <Button type="submit" variant="solid" size="sm" busy={p.saving} disabled={!p.canSave}>Lưu</Button>
                      <Button size="sm" onClick={p.onCancel}>Huỷ</Button>
                      {p.saveError && <p className={`${ui.fieldError} basis-full`}>{p.saveError}</p>}
                    </form>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span className="font-num text-num">{formatBytes(r.quotaBytes)}</span>
                      <Button size="sm" variant="quiet" onClick={() => p.onStartEdit(r.userId)}>Sửa</Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
