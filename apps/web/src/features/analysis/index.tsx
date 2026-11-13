import type { ReactNode } from 'react';
import { DICTIONARY, attributeOf, type AnalysisResult } from '@webatlas/shared';
import { openDock } from '../shell/model/shell.store';
import { useDictionary } from '../dictionary';
import { useMapCommands } from '../map/model/useMapCommands';
import { useRoi } from '../roi/model/roi.store';
import { ROI_TOOLS, toolAvailability, type Availability, type RoiTool } from '../roi/model/toolAvailability';
import { useAnalysis } from './model/useAnalysis';
import { AnalysisButtonsView } from './ui/AnalysisButtons.view';
import { AnalysisParamsView } from './ui/AnalysisParams.view';
import { UseAsRoiButton } from '../roi/ui/UseAsRoiButton';
import { AnalysisResultCardView } from './ui/AnalysisResultCard.view';

export interface AnalysisResultSlot {
  /** The result card, for the dock's Phân tích tab. */
  node: ReactNode;
  /** Xuất CSV in the dock's tab row. */
  exportCsv: () => void;
  /** Changes with each new result, so the dock can open on it. */
  result: AnalysisResult;
}

/**
 * Returns the tool buttons, the parameter form and the result, sharing one presenter. MapScreen
 * lays the buttons and the form out in the Vùng phân tích menu, and hands the result to the dock's
 * Phân tích tab; while there is a result, the menu points to it.
 */
export function useAnalysisTools(): { buttons: ReactNode; panel: ReactNode; result: AnalysisResultSlot | null } {
  const run = useMapCommands();
  const roi = useRoi();
  const a = useAnalysis({ run });
  // A served copy missing the band falls back to the code copy rather than blanking the page.
  const dem = attributeOf(useDictionary(), 'dem', '1') ?? attributeOf(DICTIONARY, 'dem', '1')!;
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
    <p className="analysis-note">
      Kết quả ở khung Phân tích.{' '}
      <button type="button" className="link" onClick={() => openDock('analysis')}>Xem kết quả</button>
    </p>
  ) : null;

  const result = a.result ? {
    result: a.result,
    exportCsv: a.exportCsv,
    node: (
    <AnalysisResultCardView
      result={a.result}
      elevation={dem}
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
      onClear={a.clear}
    />
    ),
  } : null;

  return { buttons, panel, result };
}
