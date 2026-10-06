import type { ReactNode } from 'react';
import { useMapCommands } from '../map/model/useMapCommands';
import { useRoi } from '../roi/model/roi.store';
import { ROI_TOOLS, toolAvailability, type Availability, type RoiTool } from '../roi/model/toolAvailability';
import { useAnalysis } from './model/useAnalysis';
import { AnalysisButtonsView } from './ui/AnalysisButtons.view';
import { AnalysisParamsView } from './ui/AnalysisParams.view';
import { UseAsRoiButton } from '../roi/ui/UseAsRoiButton';
import { AnalysisResultCardView } from './ui/AnalysisResultCard.view';

/**
 * Returns the tool buttons and the parameter form or result as two nodes sharing one
 * presenter — MapScreen lays them out one under the other in the Vùng phân tích menu.
 */
export function useAnalysisTools(): { buttons: ReactNode; panel: ReactNode } {
  const run = useMapCommands();
  const roi = useRoi();
  const a = useAnalysis({ run });
  const availability = Object.fromEntries(
    ROI_TOOLS.map((tool) => [tool, toolAvailability(tool, roi.resolved)])
  ) as Record<RoiTool, Availability>;

  const buttons = (
    <AnalysisButtonsView active={a.active} availability={availability} hasRegion={roi.resolved !== null} onOpen={a.open} />
  );
  const panel = a.active ? (
    <AnalysisParamsView
      tool={a.active} roiLabel={roi.resolved?.label ?? null} params={a.params} status={a.status} error={a.error}
      onParams={a.setParams} onRun={() => void a.execute()} onCancel={a.cancel}
    />
  ) : a.result ? (
    <AnalysisResultCardView
      result={a.result}
      roiLabel={a.resultRoiLabel}
      onRow={(row) => {
        if (row.layerKey && row.featureId && row.lon !== undefined && row.lat !== undefined) {
          run({ kind: 'zoomToFeature', layerKey: row.layerKey, featureId: row.featureId, lonLat: [row.lon, row.lat] });
        }
      }}
      renderRowAction={(row) =>
        row.layerKey && row.featureId
          ? <UseAsRoiButton roi={{ source: 'feature', layerKey: row.layerKey, featureId: row.featureId }} label={row.name ?? 'đối tượng'} />
          : null}
      onExport={a.exportCsv}
      onClear={a.clear}
    />
  ) : null;

  return { buttons, panel };
}
