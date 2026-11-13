import { useEffect, useRef } from 'react';
import { useMapContext } from '../../app/providers/MapProvider';
import { DICTIONARY, attributeOf, formatScenarioTime } from '@webatlas/shared';
import { useDictionary } from '../dictionary';
import { useFitOnScenario } from './model/useFitOnScenario';
import { attachDepthHover } from './model/depthHover';
import { frameUrl } from './api/flood.api';
import { clearFloodLayers, syncFloodLayers } from './model/floodLayers';
import { loadScenarios, openScenario, useFloodScenario } from './model/flood.store';
import { FloodLegendView } from './ui/FloodLegend.view';

/**
 * The map side of the open scenario: its layers, the fly-to and the depth hover. Renders nothing;
 * the scenario's figures are in the dock (features/forecast-dock), its clock in the time row.
 */
export default function FloodScenario() {
  const s = useFloodScenario();
  const { map } = useMapContext();
  // A served copy missing the band falls back to the code copy rather than blanking the page.
  const depthAttr = attributeOf(useDictionary(), 'flood_depth', '1') ?? attributeOf(DICTIONARY, 'flood_depth', '1')!;

  useEffect(() => { void loadScenarios(); }, []);

  useEffect(() => {
    if (!map) return;
    if (!s.scenarioId || s.status !== 'ready' || !s.detail) {
      clearFloodLayers(map);
      return;
    }
    syncFloodLayers(map, {
      scenarioId: s.scenarioId, frameExtent: s.detail.frameExtent, roads: s.roads,
      plan: s.planShown ? s.plan : null, hour: s.hour,
    });
  }, [map, s.scenarioId, s.status, s.detail, s.roads, s.plan, s.planShown, s.hour]);

  // Fly to the area as soon as the scenario's details arrive, before its frames finish loading.
  useFitOnScenario(map, s.detail?.id ?? null, s.detail?.frameExtent ?? null);

  const hover = useRef<ReturnType<typeof attachDepthHover> | null>(null);
  useEffect(() => {
    if (!map) return;
    hover.current = attachDepthHover(map);
    return () => { hover.current?.remove(); hover.current = null; };
  }, [map]);
  useEffect(() => {
    const ready = s.scenarioId !== null && s.status === 'ready' && s.detail !== null;
    hover.current?.update(ready ? {
      frameUrl: frameUrl(s.scenarioId!, s.hour), extent: s.detail!.frameExtent,
      time: formatScenarioTime(s.detail!.startTime, s.hour), depth: depthAttr,
    } : null);
  }, [s.scenarioId, s.status, s.detail, s.hour, depthAttr]);

  useEffect(() => () => { if (map) clearFloodLayers(map); }, [map]);

  return null;
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
