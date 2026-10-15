import type { FloodStation } from '@webatlas/shared';

export interface LevelChartViewProps {
  station: FloodStation;
  level: number[];
  forecast: (number | null)[];
  hour: number;
  bulletinHour: number;
  startTime: string;
}

const W = 600;
const H = 120;
const PAD = { left: 34, right: 54, top: 8, bottom: 18 };
const VN_OFFSET_H = 7;

/**
 * River level at one station over the scenario: alarm levels BĐ1–3 dashed, the station's record
 * dotted, the bulletin's forecast points as open circles, and the slider's hour as a cursor.
 */
export function LevelChartView({ station, level, forecast, hour, bulletinHour, startTime }: LevelChartViewProps) {
  const hours = level.length - 1;
  const refs = [station.bd1, station.bd2, station.bd3, ...(station.recordM !== null ? [station.recordM] : [])];
  const fc = forecast.filter((v): v is number => v !== null);
  const lo = Math.floor(Math.min(...level, ...refs) - 0.3);
  const hi = Math.ceil(Math.max(...level, ...refs, ...fc) + 0.3);
  const x = (h: number) => PAD.left + (h / hours) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const path = level.map((v, h) => `${h === 0 ? 'M' : 'L'}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join('');
  // Midnight ticks in Vietnam time.
  const startH = (new Date(startTime).getUTCHours() + VN_OFFSET_H) % 24;
  const midnights = Array.from({ length: hours + 1 }, (_, h) => h).filter((h) => (startH + h) % 24 === 0);
  const dayLabel = (h: number) => {
    const t = new Date(Date.parse(startTime) + (h + VN_OFFSET_H) * 3600 * 1000);
    return `${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const alarm = [
    { v: station.bd1, label: 'BĐ1' }, { v: station.bd2, label: 'BĐ2' }, { v: station.bd3, label: 'BĐ3' },
  ];

  return (
    <svg className="flood-chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Mực nước ${station.name}, cao nhất ${Math.max(...level).toFixed(2)} m`}>
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <text key={v} x={PAD.left - 4} y={y(v) + 3} className="flood-chart-axis" textAnchor="end">{v.toFixed(1)}</text>
      ))}
      {midnights.map((h) => (
        <g key={h}>
          <line x1={x(h)} x2={x(h)} y1={PAD.top} y2={H - PAD.bottom} className="flood-chart-grid" />
          <text x={x(h)} y={H - 5} className="flood-chart-axis" textAnchor="middle">{dayLabel(h)}</text>
        </g>
      ))}
      {alarm.map((a) => (
        <g key={a.label}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(a.v)} y2={y(a.v)} className="flood-chart-alarm" />
          <text x={W - PAD.right + 4} y={y(a.v) + 3} className="flood-chart-label">{a.label}</text>
        </g>
      ))}
      {station.recordM !== null && (
        <g>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(station.recordM)} y2={y(station.recordM)} className="flood-chart-record" />
          <text x={W - PAD.right + 4} y={y(station.recordM) + 3} className="flood-chart-label">LS {station.recordYear}</text>
        </g>
      )}
      <line x1={x(bulletinHour)} x2={x(bulletinHour)} y1={PAD.top} y2={H - PAD.bottom} className="flood-chart-bulletin" />
      <path d={path} className="flood-chart-level" />
      {forecast.map((v, h) => (v === null ? null : (
        <circle key={h} cx={x(h)} cy={y(v)} r={3.5} className="flood-chart-forecast" />
      )))}
      <line x1={x(hour)} x2={x(hour)} y1={PAD.top} y2={H - PAD.bottom} className="flood-chart-cursor" />
      <circle cx={x(hour)} cy={y(level[hour])} r={3.5} className="flood-chart-now" />
    </svg>
  );
}
