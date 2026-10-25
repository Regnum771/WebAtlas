import { Spinner } from '../../../shared/ui/Spinner';

export interface HistoryRowView {
  id: number;
  who: string;
  when: string;
  field: string;
  /** "old → new", already formatted. */
  change: string;
  reason: string;
}

interface Props {
  rows: HistoryRowView[];
  loading: boolean;
}

/** Passive: who changed what, when, from what to what, and why. */
export function DictionaryHistoryView({ rows, loading }: Props) {
  return (
    <section className="dictionary-history" aria-label="Lịch sử thay đổi">
      <h3>Lịch sử thay đổi</h3>
      {loading && <Spinner label="Đang tải…" />}
      {!loading && rows.length === 0 && <p className="hint">Chưa có thay đổi nào.</p>}
      {rows.length > 0 && (
        <table className="dictionary-history-table">
          <thead>
            <tr><th>Ai</th><th>Lúc</th><th>Trường</th><th>Thay đổi</th><th>Lý do</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.who}</td>
                <td>{r.when}</td>
                <td>{r.field}</td>
                <td>{r.change}</td>
                <td>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
