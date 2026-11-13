import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import {
  formatScenarioTime, type FloodScenarioDetail, type FloodScenarioId, type FloodScenarioSummary,
} from '@webatlas/shared';
import { Button } from '@/shared/ui/Button';
import { SampleTag } from '@/shared/ui/SampleTag';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/shadcn/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/shadcn/tabs';
import type { DockTab } from '../../shell/model/shell.store';
import type { FloodStatus } from '../../flood-scenario/model/flood.store';
import { forecastPointRows } from '../../flood-scenario/model/levels';
import { LevelChartView } from '../../flood-scenario/ui/LevelChart.view';
import { KpiRowView, type Kpi } from './KpiRow.view';
import { ForecastPointTableView } from './ForecastPointTable.view';
import { RainChartView } from './RainChart.view';
import type { RainDay } from '../model/rain';
import { FLOOD_SOURCES, LEVEL_SOURCE, RAIN_WAITING } from '../model/sources';


export interface ForecastDockViewProps {
  tab: DockTab;
  onTab: (tab: DockTab) => void;
  scenarios: FloodScenarioSummary[];
  scenarioId: FloodScenarioId | null;
  status: FloodStatus;
  /** Frames loaded so far, while loading. */
  loaded: number;
  error: string | null;
  /** Present once the scenario is ready. */
  detail: FloodScenarioDetail | null;
  hour: number;
  stationId: string;
  onStation: (id: string) => void;
  onScenario: (id: FloodScenarioId) => void;
  onCloseScenario: () => void;
  onRetry: () => void;
  planShown: boolean;
  onTogglePlan: () => void;
  /** The overview's KPIs at the current hour; empty until the scenario is ready. */
  kpis: Kpi[];
  /** The scenario's rain total, for the Mưa tab; null when the scenario carries none. */
  rainTotalMm: number | null;
  /** Basin daily rain up to the current time; empty until the forecast track (S3) supplies it. */
  rainDays: RainDay[];
  /** The spatial-analysis result card, or null. */
  analysis: ReactNode | null;
  /** Xuất CSV for the active tab; null: nothing to export there. */
  onExport: (() => void) | null;
}

const TABS: { id: DockTab; label: string }[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'rain', label: 'Mưa' },
  { id: 'levels', label: 'Mực nước' },
  { id: 'analysis', label: 'Phân tích' },
];

function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 text-body text-ink-2">{children}</p>;
}

function Sources() {
  return <p className="m-0 border-0 border-t border-solid border-line-3 pt-2 text-label text-ink-2">Nguồn: {FLOOD_SOURCES}</p>;
}

/** Issue time, model, horizon and the MẪU tag, with the scenario picker and its actions. */
function RunHeader(p: ForecastDockViewProps) {
  const summary = p.scenarios.find((s) => s.id === p.scenarioId) ?? null;
  const d = p.detail;
  return (
    <div data-slot="run-header" className="flex flex-col gap-1.5 border-0 border-b border-solid border-line-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {p.scenarios.length === 0 ? (
          <Note>Chưa có dữ liệu kịch bản</Note>
        ) : (
          <Select value={p.scenarioId ?? undefined} onValueChange={(v) => p.onScenario(v as FloodScenarioId)}>
            <SelectTrigger aria-label="Kịch bản lũ" className="max-w-full min-w-0 flex-1">
              <SelectValue placeholder="Chọn kịch bản lũ" />
            </SelectTrigger>
            <SelectContent>
              {p.scenarios.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {p.scenarioId && (
          <>
            <Button size="sm" aria-pressed={p.planShown} disabled={p.status !== 'ready'} onClick={p.onTogglePlan}
              className="aria-pressed:border-brand-line aria-pressed:bg-brand-tint aria-pressed:text-brand">
              Phương án sơ tán
            </Button>
            <Button size="sm" variant="quiet" onClick={p.onCloseScenario}>Đóng kịch bản</Button>
          </>
        )}
      </div>
      {d && summary && (
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-label text-ink-2">
          <span>Phát hành <span className="font-num text-ink">{formatScenarioTime(d.startTime, d.bulletinHour)}</span></span>
          <span aria-hidden="true">·</span>
          <span>Mô hình: ngập nhanh trên FABDEM, mặt nước đồng thấp hơn sông {summary.floodplainOffsetM.toLocaleString('vi-VN')} m</span>
          <span aria-hidden="true">·</span>
          <span>Tầm dự báo <span className="font-num text-ink">{d.hours - d.bulletinHour}</span> giờ</span>
          <SampleTag />
        </p>
      )}
      {summary && <p className="m-0 text-label text-ink-2">{summary.basis}</p>}
      {p.status === 'loading' && <Note>Đang tải khung ngập {p.loaded}/{(summary?.hours ?? 0) + 1}</Note>}
      {p.status === 'error' && (
        <p role="alert" className="m-0 text-body text-alert-ink">
          {p.error ?? 'Không tải được kịch bản lũ.'}{' '}
          <button type="button" className="link" onClick={p.onRetry}>Thử lại</button>
        </p>
      )}
    </div>
  );
}

function StationSelect({ detail, stationId, onStation }: Pick<ForecastDockViewProps, 'stationId' | 'onStation'> & { detail: FloodScenarioDetail }) {
  return (
    <Select value={stationId} onValueChange={onStation}>
      <SelectTrigger aria-label="Điểm dự báo" className="w-fit">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {detail.stations.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.derived ? ' (ước tính)' : ''}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function levelChart(d: FloodScenarioDetail, stationId: string, hour: number) {
  const station = d.stations.find((s) => s.id === stationId) ?? d.stations[0];
  const series = station ? d.series[station.id] : undefined;
  if (!station || !series) return null;
  return (
    <LevelChartView key={station.id} station={station} level={series.level} forecast={series.forecast} hour={hour}
      bulletinHour={d.bulletinHour} startTime={d.startTime} source={LEVEL_SOURCE} sample />
  );
}

/**
 * The forecast and analysis view of the dock (spec artboard 3b v2): the run header, then the
 * underline tabs Tổng quan · Mưa · Mực nước · Phân tích with Xuất CSV, each tab with its sources.
 */
export function ForecastDockView(p: ForecastDockViewProps) {
  const d = p.status === 'ready' ? p.detail : null;
  const waiting = p.scenarioId === null
    ? <Note>Chưa mở kịch bản lũ. Chọn một kịch bản ở trên, hoặc từ công cụ Kịch bản lũ trên bản đồ.</Note>
    : p.status === 'ready' ? null : <Note>Đang chờ kịch bản tải xong.</Note>;
  const asOf = d ? formatScenarioTime(d.startTime, p.hour) : '';

  return (
    <div data-slot="forecast-dock" className="flex min-h-full flex-col text-body text-ink">
      <RunHeader {...p} />
      <Tabs value={p.tab} onValueChange={(v) => p.onTab(v as DockTab)} className="min-h-0 flex-1">
        <div className="flex items-center justify-between gap-2 px-3">
          <TabsList aria-label="Nội dung khung" className="flex-1">
            {TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
          </TabsList>
          <Button size="sm" variant="quiet" disabled={!p.onExport} onClick={() => p.onExport?.()}>
            <Download size={14} aria-hidden="true" />Xuất CSV
          </Button>
        </div>

        <TabsContent value="overview" className="flex flex-col gap-3 p-3">
          {waiting ?? (d && (
            <>
              <KpiRowView items={p.kpis} asOf={asOf} />
              <Note>Mưa lưu vực: {RAIN_WAITING}</Note>
              <div className="flex flex-col gap-1.5">
                <StationSelect detail={d} stationId={p.stationId} onStation={p.onStation} />
                {levelChart(d, p.stationId, p.hour)}
              </div>
              <ForecastPointTableView rows={forecastPointRows(d)} startTime={d.startTime} />
              <Sources />
            </>
          ))}
        </TabsContent>

        <TabsContent value="rain" className="flex flex-col gap-3 p-3">
          {waiting ?? (
            <>
              <KpiRowView
                asOf={asOf}
                items={[{
                  label: 'Tổng mưa của kịch bản', value: p.rainTotalMm, unit: 'mm', format: { maximumFractionDigits: 0 },
                  note: p.rainTotalMm === null ? 'bản tin KTTV không kèm tổng mưa' : 'cả đợt, trung bình lưu vực',
                }]}
              />
              {p.rainDays.length > 0
                ? <RainChartView days={p.rainDays} source="MSWEP (GloH2O)" sample />
                : <Note>{RAIN_WAITING}</Note>}
            </>
          )}
        </TabsContent>

        <TabsContent value="levels" className="flex flex-col gap-4 p-3">
          {waiting ?? (d && (
            <>
              <ForecastPointTableView rows={forecastPointRows(d)} startTime={d.startTime} />
              {d.stations.map((s) => <div key={s.id}>{levelChart(d, s.id, p.hour)}</div>)}
              <Sources />
            </>
          ))}
        </TabsContent>

        <TabsContent value="analysis" className="flex flex-col gap-3 p-3">
          {p.analysis ?? (
            <Note>Chưa có kết quả phân tích. Chọn một vùng trong công cụ Vùng phân tích trên bản đồ, rồi chạy một phép phân tích; kết quả hiện ở đây.</Note>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
