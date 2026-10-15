import { Pause, Play, X } from 'lucide-react';
import {
  formatScenarioTime, type FloodScenarioDetail, type FloodScenarioId, type FloodScenarioSummary,
} from '@webatlas/shared';
import type { FloodSpeed, FloodStatus } from '../model/flood.store';
import { LevelChartView } from './LevelChart.view';

export interface FloodDockViewProps {
  scenarios: FloodScenarioSummary[];
  scenarioId: FloodScenarioId | null;
  detail: FloodScenarioDetail | null;
  hour: number;
  playing: boolean;
  speed: FloodSpeed;
  status: FloodStatus;
  loaded: number;
  error: string | null;
  stationId: string;
  onScenario: (id: FloodScenarioId) => void;
  onHour: (hour: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onSpeed: (speed: FloodSpeed) => void;
  onStation: (id: string) => void;
  onRetry: () => void;
  onClose: () => void;
  planShown: boolean;
  onTogglePlan: () => void;
  /** What is flooded by the current hour; null while unknown. */
  impacts: { roadsCutKm: number; wardsWet: number; peopleEst: number } | null;
}

const SPEEDS: FloodSpeed[] = [1, 2, 4];

/** The Kịch bản lũ dock along the bottom of the map: scenario, river level chart, time slider. */
export function FloodDockView(p: FloodDockViewProps) {
  const summary = p.scenarios.find((s) => s.id === p.scenarioId) ?? null;
  const hours = p.detail?.hours ?? summary?.hours ?? 136;
  const start = p.detail?.startTime ?? summary?.startTime ?? null;
  const ready = p.status === 'ready' && p.detail !== null;
  const station = p.detail?.stations.find((s) => s.id === p.stationId) ?? p.detail?.stations[0] ?? null;
  const series = station ? p.detail?.series[station.id] : undefined;
  const time = start ? formatScenarioTime(start, p.hour) : '';
  const km2 = p.detail?.floodedKm2[p.hour];

  return (
    <section className="flood-dock" aria-label="Kịch bản lũ">
      <header className="flood-dock-head">
        <h2 className="flood-dock-title">Kịch bản lũ</h2>
        {p.scenarios.length === 0 ? (
          <p className="flood-dock-note">Chưa có dữ liệu kịch bản</p>
        ) : (
          <select className="flood-dock-select" aria-label="Kịch bản" value={p.scenarioId ?? ''}
            onChange={(e) => p.onScenario(e.target.value as FloodScenarioId)}>
            {p.scenarioId === null && <option value="" disabled>Chọn kịch bản</option>}
            {p.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {summary && (
          <p className="flood-dock-note">
            {summary.basis} · ngập: mô phỏng nhanh trên FABDEM · <span className="flood-dock-sample">Dữ liệu mẫu</span>
          </p>
        )}
        <button type="button" className="flood-dock-close" aria-label="Đóng" onClick={p.onClose}><X size={16} /></button>
      </header>

      <div className="flood-dock-body">
        {p.status === 'loading' && <p className="flood-dock-note">Đang tải khung ngập {p.loaded}/{hours + 1}</p>}
        {p.status === 'error' && (
          <p className="flood-dock-error" role="alert">
            {p.error ?? 'Không tải được kịch bản lũ.'}{' '}
            <button type="button" className="link" onClick={p.onRetry}>Thử lại</button>
          </p>
        )}
        {ready && p.impacts && (
          <p className="flood-dock-impacts">
            Đến {time}: {p.impacts.roadsCutKm.toLocaleString('vi-VN')} km đường ngập · {p.impacts.wardsWet} xã/phường đã bắt đầu ngập (~{p.impacts.peopleEst.toLocaleString('vi-VN')} người sống ở các xã này)
          </p>
        )}
        {ready && station && series && start && (
          <div className="flood-dock-chart">
            <select className="flood-dock-station" aria-label="Trạm" value={station.id} onChange={(e) => p.onStation(e.target.value)}>
              {p.detail!.stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.derived ? ' (ước tính)' : ''}</option>
              ))}
            </select>
            <LevelChartView station={station} level={series.level} forecast={series.forecast} hour={p.hour}
              bulletinHour={p.detail!.bulletinHour} startTime={start} />
          </div>
        )}
      </div>

      <div className="flood-dock-controls">
        {p.playing ? (
          <button type="button" className="flood-dock-play" aria-label="Tạm dừng" onClick={p.onPause} disabled={!ready}><Pause size={16} /></button>
        ) : (
          <button type="button" className="flood-dock-play" aria-label="Phát" onClick={p.onPlay} disabled={!ready}><Play size={16} /></button>
        )}
        <div className="flood-dock-speeds" role="group" aria-label="Tốc độ">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={p.speed === s} onClick={() => p.onSpeed(s)}>{s}×</button>
          ))}
        </div>
        <div className="flood-dock-slider">
          <input type="range" min={0} max={hours} step={1} value={p.hour} aria-label="Thời điểm" aria-valuetext={time}
            disabled={!ready} onChange={(e) => p.onHour(Number(e.target.value))} />
          {ready && (
            <span className="flood-dock-bulletin" style={{ left: `${(p.detail!.bulletinHour / hours) * 100}%` }}>Bản tin dự báo</span>
          )}
        </div>
        <button type="button" className="flood-dock-plan" aria-pressed={p.planShown} disabled={!ready} onClick={p.onTogglePlan}>
          Phương án sơ tán
        </button>
        <output className="flood-dock-time">
          {time}{km2 !== undefined ? ` · ngập ${Math.round(km2)} km²` : ''}
        </output>
      </div>
    </section>
  );
}
