import { useEffect, useRef, useState } from 'react';
import { useMapContext } from '../../app/providers/MapProvider';
import type { FloodImpacts } from '@webatlas/shared';
import { fetchImpacts } from './api/flood.api';
import { clearFloodLayers, syncFloodLayers } from './model/floodLayers';
import {
  closeScenario, hidePlan, loadScenarios, openScenario, pause, play, retry, setHour, setSpeed, showPlan, useFloodScenario,
} from './model/flood.store';
import { FloodDockView } from './ui/FloodDock.view';
import { FloodLegendView } from './ui/FloodLegend.view';
import './ui/flood.css';

/** The dock and the map layers of the open scenario; renders nothing while none is open. */
export default function FloodScenario() {
  const s = useFloodScenario();
  const { map } = useMapContext();
  const [stationId, setStationId] = useState('cau-lau');
  const fitted = useRef<string | null>(null);
  const [impacts, setImpacts] = useState<FloodImpacts['totals'] | null>(null);

  // The summary line follows the slider; an answer for an hour already left behind is dropped.
  useEffect(() => {
    if (!s.scenarioId || s.status !== 'ready') { setImpacts(null); return; }
    let current = true;
    fetchImpacts(s.scenarioId, s.hour).then((d) => { if (current) setImpacts(d.totals); }).catch(() => { if (current) setImpacts(null); });
    return () => { current = false; };
  }, [s.scenarioId, s.status, s.hour]);

  useEffect(() => { void loadScenarios(); }, []);

  useEffect(() => {
    if (!map) return;
    if (!s.scenarioId || s.status !== 'ready' || !s.detail) {
      clearFloodLayers(map);
      if (!s.scenarioId) fitted.current = null;
      return;
    }
    syncFloodLayers(map, {
      scenarioId: s.scenarioId, frameExtent: s.detail.frameExtent, roads: s.roads,
      plan: s.planShown ? s.plan : null, hour: s.hour,
    });
    // Frame the flood area once per session of the dock, not on every scenario switch.
    if (fitted.current === null) {
      fitted.current = s.scenarioId;
      map.getView().fit(s.detail.frameExtent, { padding: [60, 140, 260, 60], duration: 600 });
    }
  }, [map, s.scenarioId, s.status, s.detail, s.roads, s.plan, s.planShown, s.hour]);

  useEffect(() => () => { if (map) clearFloodLayers(map); }, [map]);

  if (!s.scenarioId) return null;
  return (
    <FloodDockView
      scenarios={s.scenarios ?? []} scenarioId={s.scenarioId} detail={s.detail} hour={s.hour} playing={s.playing}
      speed={s.speed} status={s.status} loaded={s.loaded} error={s.error} stationId={stationId}
      onScenario={(id) => void openScenario(id)} onHour={setHour} onPlay={play} onPause={pause} onSpeed={setSpeed}
      onStation={setStationId} onRetry={() => void retry()} onClose={closeScenario}
      impacts={impacts} planShown={s.planShown} onTogglePlan={() => (s.planShown ? hidePlan() : void showPlan(s.scenarioId!))}
    />
  );
}

/** The Kịch bản lũ tool menu: pick a scenario to open the dock. */
export function FloodScenarioToolContent() {
  const s = useFloodScenario();
  useEffect(() => { void loadScenarios(); }, []);
  if (s.scenarios === null) return <p className="flood-menu-note">Đang tải danh sách kịch bản…</p>;
  if (s.scenarios.length === 0) return <p className="flood-menu-note">Chưa có dữ liệu kịch bản</p>;
  return (
    <ul className="flood-menu">
      {s.scenarios.map((sc) => (
        <li key={sc.id}>
          <button type="button" className="flood-menu-item" aria-pressed={s.scenarioId === sc.id}
            onClick={() => void openScenario(sc.id)}>
            <span className="flood-menu-name">{sc.name}</span>
            <span className="flood-menu-basis">{sc.basis}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Legend rows for the open scenario, in the side panel under the layer legend. */
export function FloodLegend() {
  const s = useFloodScenario();
  if (!s.scenarioId || s.status !== 'ready') return null;
  return <FloodLegendView planShown={s.planShown} />;
}
