import { useEffect } from 'react';
import { useMapCommands } from '../../map/model/useMapCommands';
import { clearRoi, dismissRoiMessage, setRadius, useRoi } from '../model/roi.store';
import { RoiChipView } from './RoiChip.view';

/** Container: renders the chip and keeps the map's ROI layer in step with the store. */
export default function RoiChip({ drawHint, liveMeasure }: { drawHint?: string | null; liveMeasure?: string | null }) {
  const state = useRoi();
  const run = useMapCommands();
  const { resolved, fit } = state;
  useEffect(() => {
    if (resolved) run({ kind: 'showRoi', geometry: resolved.display, label: resolved.label, fit });
    else run({ kind: 'clearRoi' });
    // Only a new resolution redraws; `fit` travels with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, run]);
  return (
    <RoiChipView
      state={state} drawHint={drawHint} liveMeasure={liveMeasure}
      onRadius={(km) => void setRadius(km)} onClear={clearRoi} onDismiss={dismissRoiMessage}
    />
  );
}
