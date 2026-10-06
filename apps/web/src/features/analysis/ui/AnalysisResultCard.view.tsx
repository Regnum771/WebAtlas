import type { ReactNode } from 'react';
import type { AnalysisResult, AnalysisRow } from '@webatlas/shared';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';
import { ProfileChartView } from './ProfileChart.view';

export interface AnalysisResultCardViewProps {
  result: AnalysisResult;
  roiLabel?: string | null;
  onRow: (row: AnalysisRow) => void;
  onExport: () => void;
  onClear: () => void;
  renderRowAction?: (row: AnalysisRow) => ReactNode;
}

export function AnalysisResultCardView({ result, roiLabel, onRow, onExport, onClear, renderRowAction }: AnalysisResultCardViewProps) {
  return (
    <section className="analysis-card" aria-label="Kết quả phân tích">
      <h3 className="analysis-card-title">{ANALYSIS_TOOL_LABELS[result.op]}</h3>
      {roiLabel && <p className="analysis-note">Kết quả cho: {roiLabel}</p>}
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
              {renderRowAction?.(row)}
            </li>
          ))}
        </ul>
      )}
      {/* A tool that lists features and found none says so; a tool with no list (rows absent) says nothing. */}
      {result.rows && result.rows.length === 0 && <Message title="Không tìm thấy đối tượng nào trong vùng này." />}
      {result.truncated && <p className="analysis-note">Chỉ hiển thị một phần kết quả trên bản đồ.</p>}
      {result.attribution && <p className="analysis-attribution">{result.attribution}</p>}
      <div className="analysis-actions">
        <Button size="sm" onClick={onExport}>Xuất CSV</Button>
        <Button size="sm" variant="quiet" onClick={onClear}>Xoá kết quả</Button>
      </div>
    </section>
  );
}
