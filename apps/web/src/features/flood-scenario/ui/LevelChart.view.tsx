import { CartesianGrid, ComposedChart, Line, ReferenceLine, Scatter, XAxis, YAxis } from 'recharts';
import { formatScenarioTime, type FloodStation } from '@webatlas/shared';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/shared/ui/shadcn/chart';
import { ChartFrame, type LegendItem } from '@/shared/ui/ChartFrame';
import { DataTable } from '@/shared/ui/DataTable';
import { alarmReached, formatLevel } from '../model/levels';
import { dayLabel, midnightHours } from '../model/scenarioTime';

export interface LevelChartViewProps {
  station: FloodStation;
  level: number[];
  forecast: (number | null)[];
  /** The current hour (the time row's position). */
  hour: number;
  bulletinHour: number;
  startTime: string;
  /** The source line under the chart. */
  source: string;
  sample?: boolean;
}

interface Row { h: number; level: number; forecast: number | null }

const AXIS_LINE = { stroke: 'var(--color-line)' };
const SERIES = { level: 'var(--color-series-2)', forecast: 'var(--color-series-1)' };
// alarm-1 and alarm-2 fail the palette validator as a categorical set (ΔE 10 normal, 5 deutan) and
// alarm-1 is 2.5:1 on white, so colour never carries identity alone: each level has its own dash
// pattern and an ink text label at the line's end, and the table view names the level per hour.
const ALARMS = [
  { key: 'bd1', label: 'BĐ1', color: 'var(--color-alarm-1)', dash: '8 4' },
  { key: 'bd2', label: 'BĐ2', color: 'var(--color-alarm-2)', dash: '4 3' },
  { key: 'bd3', label: 'BĐ3', color: 'var(--color-alarm-3)', dash: '2 2' },
] as const;

const config = {
  level: { label: 'Mực nước', color: SERIES.level },
  forecast: { label: 'Dự báo trong bản tin', color: SERIES.forecast },
} satisfies ChartConfig;

function TooltipBody({ active, label, payload, startTime }: { active?: boolean; label?: number; payload?: { dataKey?: unknown; value?: unknown }[]; startTime: string }) {
  if (!active || label === undefined || !payload?.length) return null;
  const value = (key: string) => payload.find((p) => p.dataKey === key)?.value;
  const lv = value('level');
  const fc = value('forecast');
  return (
    <div className="grid gap-0.5 rounded-lg border border-solid border-line bg-surface px-2 py-1.5 text-label text-ink shadow-pop">
      <span className="font-num">{formatScenarioTime(startTime, label)}</span>
      {typeof lv === 'number' && <span>Mực nước <span className="font-num">{formatLevel(lv)}</span></span>}
      {typeof fc === 'number' && <span>Dự báo <span className="font-num">{formatLevel(fc)}</span></span>}
    </div>
  );
}

/**
 * River level at one forecast point over the scenario: the level line, the bulletin's forecast
 * points as open circles, BĐ1–BĐ3 dashed with their names, the record, the issue time and the
 * current hour, with a crosshair tooltip. The Bảng view lists every hour.
 */
export function LevelChartView({ station, level, forecast, hour, bulletinHour, startTime, source, sample }: LevelChartViewProps) {
  const hours = level.length - 1;
  const rows: Row[] = level.map((v, h) => ({ h, level: v, forecast: forecast[h] ?? null }));
  const refs = [station.bd1, station.bd2, station.bd3, ...(station.recordM !== null ? [station.recordM] : [])];
  const fc = forecast.filter((v): v is number => v !== null);
  const lo = Math.floor(Math.min(...level, ...refs) - 0.3);
  const hi = Math.ceil(Math.max(...level, ...refs, ...fc) + 0.3);
  const peak = Math.max(...level);
  const legend: LegendItem[] = [
    { label: 'Mực nước', color: SERIES.level, mark: 'line' },
    { label: 'Dự báo trong bản tin', color: SERIES.forecast, mark: 'dots' },
    ...ALARMS.map((a) => ({ label: a.label, color: a.color, mark: 'dash' as const, dash: a.dash })),
  ];
  const title = `Mực nước tại ${station.name}${station.derived ? ' (ước tính)' : ''}`;

  const chart = (
    <ChartContainer config={config} className="h-[200px] w-full" initialDimension={{ width: 460, height: 200 }}>
      <ComposedChart data={rows} margin={{ top: 12, right: 52, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="h" type="number" domain={[0, hours]} ticks={midnightHours(startTime, hours)}
          tickFormatter={(h: number) => dayLabel(startTime, h)} tickLine={false} axisLine={AXIS_LINE}
        />
        <YAxis
          domain={[lo, hi]} width={44} tickLine={false} axisLine={AXIS_LINE} tickCount={5} allowDecimals={false}
          tickFormatter={(v: number) => v.toLocaleString('vi-VN')}
          label={{ value: 'm', position: 'insideTopLeft', offset: 0, dy: -12, className: 'fill-ink-2' }}
        />
        {ALARMS.map((a) => (
          <ReferenceLine
            key={a.key} y={station[a.key]} stroke={a.color} strokeWidth={1.5} strokeDasharray={a.dash}
            label={{ value: a.label, position: 'right', fill: 'var(--color-ink-2)', fontSize: 11 }}
          />
        ))}
        {station.recordM !== null && (
          <ReferenceLine
            y={station.recordM} stroke="var(--color-ink-2)" strokeDasharray="1 3"
            label={{ value: `LS ${station.recordYear ?? ''}`.trim(), position: 'right', fill: 'var(--color-ink-2)', fontSize: 11 }}
          />
        )}
        <ReferenceLine
          x={bulletinHour} stroke="var(--color-ink-2)" strokeDasharray="3 3"
          label={{ value: 'Phát hành', position: 'insideTopRight', fill: 'var(--color-ink-2)', fontSize: 11 }}
        />
        <ReferenceLine x={hour} stroke="var(--color-ink)" label={{ value: 'Hiện tại', position: 'insideTopLeft', fill: 'var(--color-ink)', fontSize: 11 }} />
        <ChartTooltip cursor={{ stroke: 'var(--color-ink-2)', strokeDasharray: '2 2' }} content={<TooltipBody startTime={startTime} />} />
        <Line dataKey="level" type="monotone" stroke={SERIES.level} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Scatter dataKey="forecast" fill="var(--color-surface)" stroke={SERIES.forecast} strokeWidth={2} isAnimationActive={false} />
      </ComposedChart>
    </ChartContainer>
  );

  const table = (
    <DataTable
      caption={title} maxHeight={240} rows={rows} rowKey={(r) => String(r.h)}
      tone={(r) => (r.h === hour ? 'current' : undefined)}
      columns={[
        { key: 't', label: 'Thời điểm', cell: (r) => <span className="font-num">{formatScenarioTime(startTime, r.h)}</span> },
        { key: 'level', label: 'Mực nước (m)', numeric: true, cell: (r) => formatLevel(r.level, false) },
        { key: 'fc', label: 'Dự báo (m)', numeric: true, cell: (r) => (r.forecast === null ? '' : formatLevel(r.forecast, false)) },
        { key: 'alarm', label: 'Cấp báo động', cell: (r) => alarmReached(station, r.level) ?? '' },
      ]}
    />
  );

  return (
    <ChartFrame
      title={title}
      summary={`Mực nước ${station.name}, cao nhất ${formatLevel(peak)}, ${alarmReached(station, peak) ?? 'dưới BĐ1'}. Bản tin phát hành ${formatScenarioTime(startTime, bulletinHour)}.`}
      legend={legend} source={source} sample={sample} chart={chart} table={table}
    />
  );
}
