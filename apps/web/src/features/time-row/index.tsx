import { useEffect, useRef, useState } from 'react';
import {
  closeScenario, pause as pauseScenario, play as playScenario, setHour, setSpeed as setScenarioSpeed, useFloodScenario,
} from '../flood-scenario/model/flood.store';
import {
  pause as pauseLayers, play as playLayers, setSpeed as setLayersSpeed, setTime, stepBy, useTimeSlider,
} from '../time-slider/model/timeSlider.store';
import { layersModel, scenarioModel } from './model/timeRowModel';
import { TimeRowView } from './ui/TimeRow.view';

/** Published on the map stage while the row shows, so the floats above it (contents panel, tool
 *  menus, toasts, the dock's drawer) end above it. */
const TIME_ROW_HEIGHT_VAR = '--time-row-height';

/**
 * The one time row (K4 plan, decision 8): the open flood scenario drives it; otherwise the time
 * layers on the map do. × closes the scenario, or hides the row for the layers until their set of
 * steps changes.
 */
export default function TimeRow() {
  const flood = useFloodScenario();
  const slider = useTimeSlider();
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const ref = useRef<HTMLElement | null>(null);

  const scenario = scenarioModel(flood);
  const layers = layersModel(slider);
  const model = scenario ?? (layers && layers.signature !== hiddenFor ? layers : null);

  const shown = model !== null;
  useEffect(() => {
    const stage = ref.current?.closest<HTMLElement>('.map-stage-map');
    if (!shown || !stage) return;
    stage.style.setProperty(TIME_ROW_HEIGHT_VAR, 'var(--time-row-size)');
    return () => { stage.style.removeProperty(TIME_ROW_HEIGHT_VAR); };
  }, [shown]);

  if (!model) return null;
  if (model.source === 'scenario') {
    return (
      <TimeRowView
        ref={ref} model={model} closeLabel="Đóng kịch bản lũ"
        onIndex={setHour} onStep={(d) => setHour(flood.hour + d * flood.speed)}
        onPlay={playScenario} onPause={pauseScenario} onStepSize={setScenarioSpeed} onClose={closeScenario}
      />
    );
  }
  return (
    <TimeRowView
      ref={ref} model={model} closeLabel="Ẩn hàng thời gian"
      onIndex={(i) => { const s = slider.steps[i]; if (s) setTime(s); }}
      onStep={(d) => stepBy(d * slider.speed)}
      onPlay={playLayers} onPause={pauseLayers} onStepSize={setLayersSpeed}
      onClose={() => { pauseLayers(); setHiddenFor(model.signature); }}
    />
  );
}
