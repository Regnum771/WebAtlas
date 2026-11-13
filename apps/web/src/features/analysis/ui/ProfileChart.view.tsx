import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { convert, formatValue, unit, type DictAttribute, type ProfileSample } from '@webatlas/shared';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/shared/ui/shadcn/chart';
import { ChartFrame } from '@/shared/ui/ChartFrame';
import { DataTable } from '@/shared/ui/DataTable';

export interface ProfileChartViewProps {
  profile: ProfileSample[];
  /** The dem band: the axis, tooltip and table show elevation in its display unit. */
  elevation: DictAttribute;
  /** The data source line; the result's attribution when it has one. */
  source?: string;
}

interface Row { km: number; elevationM: number; display: number }

const COLOR = 'var(--color-series-1)';
const AXIS_LINE = { stroke: 'var(--color-line)' };
const config = { display: { label: 'Độ cao', color: COLOR } } satisfies ChartConfig;
const km = (m: number) => Math.round(m / 10) / 100;
const kmText = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });

function TooltipBody({ active, payload, elevation }: { active?: boolean; payload?: { payload?: Row }[]; elevation: DictAttribute }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="grid gap-0.5 rounded-lg border border-solid border-line bg-surface px-2 py-1.5 text-label text-ink shadow-pop">
      <span className="font-num">{kmText(row.km)} km</span>
      <span>Độ cao <span className="font-num">{formatValue(elevation, row.elevationM)}</span></span>
    </div>
  );
}

/**
 * The elevation profile along a line: distance (km) against elevation in the dem band's display
 * unit, with a crosshair tooltip, and the samples in its Bảng view. Samples with no elevation (off
 * the DEM) are left out of both.
 */
export function ProfileChartView({ profile, elevation, source }: ProfileChartViewProps) {
  const from = elevation.storedUnit;
  const to = elevation.displayUnit ?? from;
  const toDisplay = (m: number) => (from && to ? convert(m, from, to) : m);
  const symbol = to ? unit(to).symbol : '';
  const rows: Row[] = profile
    .filter((p): p is { distanceM: number; elevationM: number } => p.elevationM !== null)
    .map((p) => ({ km: km(p.distanceM), elevationM: p.elevationM, display: toDisplay(p.elevationM) }));
  if (rows.length < 2) return null;
  const lengthKm = km(profile[profile.length - 1].distanceM);
  const minE = Math.min(...rows.map((r) => r.elevationM));
  const maxE = Math.max(...rows.map((r) => r.elevationM));

  const chart = (
    <ChartContainer config={config} className="h-[180px] w-full" initialDimension={{ width: 460, height: 180 }}>
      <AreaChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="km" type="number" domain={[0, lengthKm]} tickLine={false} axisLine={AXIS_LINE}
          tickFormatter={kmText} unit=" km"
        />
        <YAxis
          dataKey="display" width={52} tickLine={false} axisLine={AXIS_LINE} domain={['auto', 'auto']}
          tickFormatter={(v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}
          label={{ value: symbol, position: 'insideTopLeft', offset: 0, dy: -12, className: 'fill-ink-2' }}
        />
        <ChartTooltip cursor={{ stroke: 'var(--color-ink-2)', strokeDasharray: '2 2' }} content={<TooltipBody elevation={elevation} />} />
        <Area dataKey="display" type="linear" stroke={COLOR} strokeWidth={2} fill={COLOR} fillOpacity={0.12} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );

  const table = (
    <DataTable
      caption="Trắc diện độ cao" maxHeight={240} rows={rows} rowKey={(r, i) => `${r.km}-${i}`}
      columns={[
        { key: 'km', label: 'Khoảng cách (km)', numeric: true, cell: (r) => kmText(r.km) },
        { key: 'e', label: `Độ cao (${symbol})`, numeric: true, cell: (r) => formatValue(elevation, r.elevationM).replace(` ${symbol}`, '') },
      ]}
    />
  );

  return (
    <ChartFrame
      title="Trắc diện độ cao"
      summary={`Trắc diện dài ${kmText(lengthKm)} km, độ cao từ ${formatValue(elevation, minE)} đến ${formatValue(elevation, maxE)}.`}
      legend={[{ label: 'Độ cao', color: COLOR, mark: 'line' }]}
      source={source ?? 'mô hình số độ cao FABDEM'}
      chart={chart} table={table}
    />
  );
}
