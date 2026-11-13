import { Spinner } from '../../../shared/ui/Spinner';
import { ui } from '../../../shared/ui/styles';

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
  /** The query returned its limit: older entries exist and are not shown. */
  truncated?: boolean;
}

/** Passive: who changed what, when, from what to what, and why. */
export function DictionaryHistoryView({ rows, loading, truncated }: Props) {
  return (
    <section data-slot="dictionary-history" className={ui.section} aria-label="Lịch sử thay đổi">
      <h3 className="text-panel font-semibold">Lịch sử thay đổi</h3>
      {loading && <Spinner label="Đang tải…" />}
      {!loading && rows.length === 0 && <p className={ui.note}>Chưa có thay đổi nào.</p>}
      {truncated && <p className={ui.note}>Chỉ hiện 200 thay đổi gần nhất.</p>}
      {rows.length > 0 && (
        <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead className={ui.thead}>
            <tr>{['Ai', 'Lúc', 'Trường', 'Thay đổi', 'Lý do'].map((h) => <th key={h} scope="col" className={ui.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={ui.tr}>
                <td className={ui.td}>{r.who}</td>
                <td className={`${ui.td} font-num text-num whitespace-nowrap text-ink-2`}>{r.when}</td>
                <td className={ui.td}>{r.field}</td>
                <td className={`${ui.td} [overflow-wrap:anywhere]`}>{r.change}</td>
                <td className={`${ui.td} text-ink-2`}>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}
