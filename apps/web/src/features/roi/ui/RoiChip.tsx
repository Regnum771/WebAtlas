import { useEffect, useRef } from 'react';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useMapCommands } from '../../map/model/useMapCommands';
import { clearRoi, dismissRoiMessage, setRadius, useRoi } from '../model/roi.store';
import { useDrawFeedback } from '../../map/model/drawingState';
import { RoiChipView } from './RoiChip.view';

/** Container: renders the chip and keeps the map's ROI layer in step with the store. */
export default function RoiChip({ drawHint, liveMeasure }: { drawHint?: string | null; liveMeasure?: string | null }) {
  const state = useRoi();
  const feedback = useDrawFeedback();
  const run = useMapCommands();
  const { map } = useMapContext();
  const runRef = useRef(run);
  runRef.current = run;
  const { resolved, fit } = state;
  // Redraws on a new resolution or when the map appears — not when the executor is rebuilt
  // (every layer toggle), which would re-fit the view. `fit` travels with the resolution.
  useEffect(() => {
    if (!map) return;
    if (resolved) runRef.current({ kind: 'showRoi', geometry: resolved.display, label: resolved.label, fit });
    else runRef.current({ kind: 'clearRoi' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, map]);
  return (
    <RoiChipView
      state={state} drawHint={drawHint ?? feedback.hint} liveMeasure={liveMeasure ?? feedback.measure}
      onRadius={(km) => void setRadius(km)} onClear={clearRoi} onDismiss={dismissRoiMessage}
    />
  );
}
