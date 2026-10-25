import type { ReactNode } from 'react';
import { formatValue, type AnalysisResult, type AnalysisRow, type DictAttribute } from '@webatlas/shared';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';
import { ProfileChartView } from './ProfileChart.view';

const ELEVATION_SUFFIX = ' (m)';

export interface AnalysisResultCardViewProps {
  result: AnalysisResult;
  /** The dem band: elevation figures in the summary and profile are shown in its display unit. */
  elevation: DictAttribute;
  roiLabel?: string | null;
  onRow: (row: AnalysisRow) => void;
  onExport: () => void;
  onClear: () => void;
  renderRowAction?: (row: AnalysisRow) => ReactNode;
}

export function AnalysisResultCardView({ result, elevation, roiLabel, onRow, onExport, onClear, renderRowAction }: AnalysisResultCardViewProps) {
  return (
    <section className="analysis-card" aria-label="Kết quả phân tích">
      <h3 className="analysis-card-title">{ANALYSIS_TOOL_LABELS[result.op]}</h3>
      {roiLabel && <p className="analysis-note">Kết quả cho: {roiLabel}</p>}
      <table className="analysis-summary">
        <tbody>
          {Object.entries(result.summary).map(([k, v]) => {
            // The API labels elevation figures "… (m)" and sends metres; show them in the display unit.
            const isElevation = typeof v === 'number' && k.endsWith(ELEVATION_SUFFIX);
            return (
              <tr key={k}>
                <th scope="row">{isElevation ? k.slice(0, -ELEVATION_SUFFIX.length) : k}</th>
                <td>{isElevation ? formatValue(elevation, v) : String(v)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {result.profile && <ProfileChartView profile={result.profile} elevation={elevation} />}
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
