import { useId, type ReactNode } from 'react';
import { SquareDashed, Sigma, TrendingUp, LocateFixed } from 'lucide-react';
import { ROI_TOOLS, type Availability, type RoiTool } from '../../roi/model/toolAvailability';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';

const ICONS: Record<RoiTool, ReactNode> = {
  select_within: <SquareDashed size={16} aria-hidden="true" />,
  zonal_elevation: <Sigma size={16} aria-hidden="true" />,
  elevation_profile: <TrendingUp size={16} aria-hidden="true" />,
  nearest: <LocateFixed size={16} aria-hidden="true" />,
};

export interface AnalysisButtonsViewProps {
  active: RoiTool | null;
  availability: Record<RoiTool, Availability>;
  /** False: there is no region at all, so the tools share one line instead of a reason each. */
  hasRegion: boolean;
  onOpen: (tool: RoiTool) => void;
}

/**
 * A tool that cannot run uses aria-disabled, not `disabled`: it stays focusable, so its
 * reason — the text beside it, tied with aria-describedby — is reachable (U-2, NFR-4).
 * These are plain `.btn` buttons because the shared Button reserves aria-disabled for `busy`.
 */
export function AnalysisButtonsView({ active, availability, hasRegion, onOpen }: AnalysisButtonsViewProps) {
  const baseId = useId();
  const sharedReasonId = `${baseId}-no-region`;
  return (
    <div className="tool-section" role="group" aria-label="Phân tích">
      {ROI_TOOLS.map((tool) => {
        const a = availability[tool];
        const reasonId = a.enabled ? undefined : hasRegion ? `${baseId}-${tool}` : sharedReasonId;
        return (
          <div key={tool} className="analysis-tool">
            <button
              type="button"
              className={active === tool ? 'btn sm solid' : 'btn sm'}
              aria-pressed={active === tool}
              aria-disabled={a.enabled ? undefined : true}
              aria-describedby={reasonId}
              onClick={() => { if (a.enabled) onOpen(tool); }}
            >
              {ICONS[tool]}{ANALYSIS_TOOL_LABELS[tool]}
            </button>
            {!a.enabled && hasRegion && <span id={reasonId} className="analysis-tool-reason">{a.reason}</span>}
          </div>
        );
      })}
      {!hasRegion && <p id={sharedReasonId} className="analysis-tool-reason">Vẽ hoặc chọn một vùng trước.</p>}
    </div>
  );
}
