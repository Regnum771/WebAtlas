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
  onClear: () => void;
  renderRowAction?: (row: AnalysisRow) => ReactNode;
}

/**
 * A spatial-analysis result in the dock's Phân tích tab: the tool and region, the summary figures,
 * the profile chart, the features found (each zooms the map), and the source. Xuất CSV is in the
 * dock's tab row.
 */
export function AnalysisResultCardView({ result, elevation, roiLabel, onRow, onClear, renderRowAction }: AnalysisResultCardViewProps) {
  return (
    <section data-slot="analysis-result" aria-label="Kết quả phân tích" className="flex flex-col gap-3 text-body text-ink">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-panel font-semibold">{ANALYSIS_TOOL_LABELS[result.op]}</h3>
          {roiLabel && <p className="m-0 text-label text-ink-2">Kết quả cho: {roiLabel}</p>}
        </div>
        <Button size="sm" variant="quiet" onClick={onClear}>Xoá kết quả</Button>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {Object.entries(result.summary).map(([k, v]) => {
            // The API labels elevation figures "… (m)" and sends metres; show them in the display unit.
            const isElevation = typeof v === 'number' && k.endsWith(ELEVATION_SUFFIX);
            return (
              <tr key={k} className="h-control-sm border-0 border-b border-solid border-line-3">
                <th scope="row" className="pr-2 text-left font-normal text-ink-2">{isElevation ? k.slice(0, -ELEVATION_SUFFIX.length) : k}</th>
                <td className="text-right font-num text-num">{isElevation ? formatValue(elevation, v) : String(v)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {result.profile && <ProfileChartView profile={result.profile} elevation={elevation} source={result.attribution} />}
      {result.rows && result.rows.length > 0 && (
        <ul className="m-0 flex max-h-[220px] list-none flex-col overflow-y-auto rounded-md border border-solid border-line p-0">
          {result.rows.map((row, i) => (
            <li key={row.featureId ?? i} className="flex min-h-control-sm items-center justify-between gap-2 border-0 border-b border-solid border-line-3 px-2 last:border-b-0">
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left text-body text-water hover:underline" onClick={() => onRow(row)}>
                {row.name ?? '(không tên)'}
                {row.distanceKm !== undefined && <span className="text-ink-2"> · <span className="font-num">{row.distanceKm}</span> km</span>}
              </button>
              {renderRowAction?.(row)}
            </li>
          ))}
        </ul>
      )}
      {/* A tool that lists features and found none says so; a tool with no list (rows absent) says nothing. */}
      {result.rows && result.rows.length === 0 && <Message title="Không tìm thấy đối tượng nào trong vùng này." />}
      {result.truncated && <p className="m-0 text-label text-ink-2">Chỉ hiển thị một phần kết quả trên bản đồ.</p>}
      {result.attribution && !result.profile && <p className="m-0 text-label text-ink-2">Nguồn: {result.attribution}</p>}
    </section>
  );
}
