import type { AnalysisResult, AnalysisRow } from '@webatlas/shared';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';
import { ProfileChartView } from './ProfileChart.view';

export interface AnalysisResultCardViewProps {
  result: AnalysisResult;
  onRow: (row: AnalysisRow) => void;
  onExport: () => void;
  onClear: () => void;
}

export function AnalysisResultCardView({ result, onRow, onExport, onClear }: AnalysisResultCardViewProps) {
  return (
    <section className="analysis-card glass-panel" aria-label="Kết quả phân tích">
      <h3 className="analysis-card-title">{ANALYSIS_TOOL_LABELS[result.op]}</h3>
      <table className="analysis-summary">
        <tbody>
          {Object.entries(result.summary).map(([k, v]) => (
            <tr key={k}><th scope="row">{k}</th><td>{String(v)}</td></tr>
          ))}
        </tbody>
      </table>
      {result.profile && <ProfileChartView profile={result.profile} />}
      {result.rows && result.rows.length > 0 && (
        <ul className="analysis-rows">
          {result.rows.map((row, i) => (
            <li key={row.featureId ?? i}>
              <button type="button" className="analysis-row" onClick={() => onRow(row)}>
                {row.name ?? '(không tên)'}
                {row.distanceKm !== undefined && <span className="analysis-row-meta"> · {row.distanceKm} km</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {result.truncated && <p className="analysis-note">Chỉ hiển thị một phần kết quả trên bản đồ.</p>}
      {result.attribution && <p className="analysis-attribution">{result.attribution}</p>}
      <div className="analysis-actions">
        <button type="button" onClick={onExport}>Xuất CSV</button>
        <button type="button" onClick={onClear}>Xoá kết quả</button>
      </div>
    </section>
  );
}
