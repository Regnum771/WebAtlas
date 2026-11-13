import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/shared/ui/shadcn/chart';
import { ChartFrame } from '@/shared/ui/ChartFrame';
import { DataTable } from '@/shared/ui/DataTable';
import { runningTotals, type RainDay } from '../model/rain';

export interface RainChartViewProps {
  days: RainDay[];
  source: string;
  sample?: boolean;
}

const COLOR = 'var(--color-series-1)';
const AXIS_LINE = { stroke: 'var(--color-line)' };
const config = { mm: { label: 'Mưa ngày', color: COLOR } } satisfies ChartConfig;
const mmText = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const dayText = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function TooltipBody({ active, payload }: { active?: boolean; payload?: { payload?: RainDay & { total: number } }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="grid gap-0.5 rounded-lg border border-solid border-line bg-surface px-2 py-1.5 text-label text-ink shadow-pop">
      <span className="font-num">{dayText(row.date)}/{row.date.slice(0, 4)}</span>
      <span>Mưa ngày <span className="font-num">{mmText(row.mm)} mm</span></span>
      <span>Lũy kế <span className="font-num">{mmText(row.total)} mm</span></span>
    </div>
  );
}

/**
 * Basin daily rain as bars on one axis (mm). The running total is a different measure, so it is
 * not drawn on a second axis: it is in the summary, the tooltip and the Bảng view.
 * Waits for the forecast track's rain series (S3); until then the dock shows its empty state.
 */
export function RainChartView({ days, source, sample }: RainChartViewProps) {
  const totals = runningTotals(days);
  const rows = days.map((d, i) => ({ ...d, total: totals[i] }));
  const total = totals[totals.length - 1] ?? 0;
  const wettest = days.reduce<RainDay | null>((a, d) => (a === null || d.mm > a.mm ? d : a), null);

  const chart = (
    <ChartContainer config={config} className="h-[170px] w-full" initialDimension={{ width: 460, height: 170 }}>
      <BarChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={AXIS_LINE} tickFormatter={dayText} minTickGap={12} />
        <YAxis
          width={44} tickLine={false} axisLine={AXIS_LINE} allowDecimals={false}
          tickFormatter={(v: number) => v.toLocaleString('vi-VN')}
          label={{ value: 'mm', position: 'insideTopLeft', offset: 0, dy: -12, className: 'fill-ink-2' }}
        />
        <ChartTooltip cursor={{ fill: 'var(--color-surface-2)' }} content={<TooltipBody />} />
        <Bar dataKey="mm" fill={COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );

  const table = (
    <DataTable
      caption="Mưa lưu vực theo ngày" maxHeight={240} rows={rows} rowKey={(r) => r.date}
      columns={[
        { key: 'd', label: 'Ngày', cell: (r) => <span className="font-num">{dayText(r.date)}/{r.date.slice(0, 4)}</span> },
        { key: 'mm', label: 'Mưa ngày (mm)', numeric: true, cell: (r) => mmText(r.mm) },
        { key: 'total', label: 'Lũy kế (mm)', numeric: true, cell: (r) => mmText(r.total) },
      ]}
    />
  );

  return (
    <ChartFrame
      title="Mưa lưu vực theo ngày"
      summary={`Tổng ${mmText(total)} mm trong ${days.length} ngày${wettest ? `, nhiều nhất ${mmText(wettest.mm)} mm ngày ${dayText(wettest.date)}` : ''}.`}
      legend={[{ label: 'Mưa ngày, trung bình lưu vực', color: COLOR, mark: 'bar' }]}
      source={source} sample={sample} chart={chart} table={table}
    />
  );
}
