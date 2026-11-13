import { useEffect, useState } from 'react';
import type { AnalysisResultSlot } from '../analysis';
import { setDockTab, useShell } from '../shell/model/shell.store';
import {
  closeScenario, hidePlan, loadScenarios, openScenario, retry, showPlan, useFloodScenario,
} from '../flood-scenario/model/flood.store';
import { useImpactsSummary } from '../flood-scenario/model/useImpactsSummary';
import { alarmReached, formatLevel } from '../flood-scenario/model/levels';
import { ForecastDockView } from './ui/ForecastDock.view';
import type { Kpi } from './ui/KpiRow.view';
import { downloadText, forecastCsv } from './model/csv';

const DEFAULT_STATION = 'cau-lau';
const ALARM_KEY = { 'BĐ1': 'bd1', 'BĐ2': 'bd2', 'BĐ3': 'bd3' } as const;

/**
 * The forecast and analysis view of the dock. Reads the open flood scenario (until the forecast
 * track's S3/S4 supply live rain and forecast runs) and the analysis result MapScreen hands over.
 */
export default function ForecastDock({ analysis }: { analysis: AnalysisResultSlot | null }) {
  const s = useFloodScenario();
  const { dockTab } = useShell();
  const [stationId, setStationId] = useState(DEFAULT_STATION);
  const ready = s.status === 'ready' && s.detail !== null;
  const impacts = useImpactsSummary(s.scenarioId, ready, s.hour);

  useEffect(() => { void loadScenarios(); }, []);

  const d = ready ? s.detail : null;
  const station = d ? d.stations.find((st) => st.id === stationId) ?? d.stations[0] : undefined;
  const level = station && d ? d.series[station.id]?.level[s.hour] ?? null : null;
  const alarm = station && level !== null ? alarmReached(station, level) : null;
  const kpis: Kpi[] = d && station ? [
    {
      label: `Mực nước ${station.name}`, value: level, unit: 'm', format: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
      note: alarm ? `trên ${alarm} (${formatLevel(station[ALARM_KEY[alarm]])})` : `dưới BĐ1 (${formatLevel(station.bd1)})`,
      tone: alarm ? 'alert' : undefined,
    },
    { label: 'Diện tích ngập', value: d.floodedKm2[s.hour] ?? null, unit: 'km²', format: { maximumFractionDigits: 0 }, note: 'ngập mới so với trước lũ' },
    {
      label: 'Đường chính ngập', value: impacts?.roadsCutKm ?? null, unit: 'km', format: { maximumFractionDigits: 1 },
      note: impacts ? `${impacts.roadsCut} đoạn, sâu ≥ 0,3 m` : undefined,
    },
    {
      label: 'Xã/phường bị ngập', value: impacts?.wardsWet ?? null, unit: 'xã', format: { maximumFractionDigits: 0 },
      note: impacts ? `~${impacts.peopleEst.toLocaleString('vi-VN')} người trong nhà bị ngập` : undefined,
    },
  ] : [];

  const summary = s.scenarios?.find((x) => x.id === s.scenarioId) ?? null;
  let onExport: (() => void) | null = null;
  if (dockTab === 'analysis') onExport = analysis?.exportCsv ?? null;
  else if ((dockTab === 'overview' || dockTab === 'levels') && d) {
    onExport = () => downloadText(forecastCsv(d), `kich-ban-lu-${d.id}.csv`);
  }

  return (
    <ForecastDockView
      tab={dockTab} onTab={setDockTab}
      scenarios={s.scenarios ?? []} scenarioId={s.scenarioId} status={s.status} loaded={s.loaded} error={s.error}
      detail={s.detail} hour={s.hour}
      stationId={station?.id ?? stationId} onStation={setStationId}
      onScenario={(id) => void openScenario(id)} onCloseScenario={closeScenario} onRetry={() => void retry()}
      planShown={s.planShown} onTogglePlan={() => (s.planShown ? hidePlan() : s.scenarioId && void showPlan(s.scenarioId))}
      kpis={kpis}
      rainTotalMm={summary?.rainTotalMm ?? null}
      rainDays={[]}
      analysis={analysis?.node ?? null}
      onExport={onExport}
    />
  );
}
