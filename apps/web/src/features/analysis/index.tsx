import { useCallback, useMemo, type ReactNode } from 'react';
import { useMapContext } from '../../app/providers/MapProvider';
import { createCommandExecutor } from '../map/model/mapCommands';
import { startAnalysisDraw } from '../map/model/analysisDraw';
import { getLastShape } from '../map/model/lastShape';
import { useAnalysis } from './model/useAnalysis';
import { AnalysisButtonsView } from './ui/AnalysisButtons.view';
import { AnalysisParamsView } from './ui/AnalysisParams.view';
import { AnalysisResultCardView } from './ui/AnalysisResultCard.view';

/**
 * Returns the toolbar buttons and the panel above the toolbar as two nodes sharing
 * one presenter — the toolbar renders them in different places.
 */
export function useAnalysisTools(): { buttons: ReactNode; panel: ReactNode } {
  const { map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState } = useMapContext();
  const run = useMemo(
    () => createCommandExecutor({
      map, setBasemap, toggleLayerVisibility, setLayerOpacity,
      getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
      layerExists: (id) => layersState.some((l) => l.id === id),
    }),
    [map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState]
  );
  const startDraw = useCallback<Parameters<typeof useAnalysis>[0]['startDraw']>(
    (kind, onDone) => (map ? startAnalysisDraw(map, kind, onDone) : () => {}),
    [map]
  );
  const a = useAnalysis({ startDraw, run, getLastShape });

  const buttons = <AnalysisButtonsView active={a.active} onOpen={a.open} />;
  const panel = a.active ? (
    <AnalysisParamsView
      op={a.active} params={a.params} status={a.status} error={a.error}
      onParams={a.setParams} onDraw={a.draw} onUseLast={a.useLastShape} onCancel={a.cancel}
    />
  ) : a.result ? (
    <AnalysisResultCardView
      result={a.result}
      onRow={(row) => {
        if (row.layerKey && row.featureId && row.lon !== undefined && row.lat !== undefined) {
          run({ kind: 'zoomToFeature', layerKey: row.layerKey, featureId: row.featureId, lonLat: [row.lon, row.lat] });
        }
      }}
      onExport={a.exportCsv}
      onClear={a.clear}
    />
  ) : null;

  return { buttons, panel };
}
