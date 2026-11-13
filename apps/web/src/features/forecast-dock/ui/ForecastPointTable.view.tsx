import { formatScenarioTime } from '@webatlas/shared';
import { DataTable } from '@/shared/ui/DataTable';
import { formatLevel, type ForecastPointRow } from '../../flood-scenario/model/levels';

export interface ForecastPointTableViewProps {
  rows: ForecastPointRow[];
  startTime: string;
}

/**
 * Bulletin level, forecast peak, time of peak and the alarm level reached at each forecast point.
 * A row whose peak reaches an alarm level is highlighted in the alert tint, and says the level.
 */
export function ForecastPointTableView({ rows, startTime }: ForecastPointTableViewProps) {
  return (
    <DataTable
      caption="Điểm dự báo" rows={rows} rowKey={(r) => r.station.id}
      tone={(r) => (r.alarm ? 'alert' : undefined)}
      columns={[
        { key: 'name', label: 'Điểm dự báo', cell: (r) => `${r.station.name}${r.station.derived ? ' (ước tính)' : ''}` },
        { key: 'bulletin', label: 'Phát hành (m)', numeric: true, cell: (r) => formatLevel(r.bulletinLevel, false) },
        { key: 'peak', label: 'Đỉnh (m)', numeric: true, cell: (r) => (r.forecastPeak === null ? '—' : formatLevel(r.forecastPeak, false)) },
        // Without the year, so the five columns fit the 500 px dock; the run header gives the year.
        { key: 'at', label: 'Lúc đỉnh', cell: (r) => (r.forecastPeakHour === null ? '—' : <span className="font-num">{formatScenarioTime(startTime, r.forecastPeakHour).slice(0, -5)}</span>) },
        { key: 'alarm', label: 'Báo động', cell: (r) => r.alarm ?? 'dưới BĐ1' },
      ]}
    />
  );
}
