import { Fragment, type ReactNode } from 'react';
import { SquareDashed, Sigma, TrendingUp, LocateFixed } from 'lucide-react';
import type { Availability, RoiTool } from '../../roi/model/toolAvailability';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';

const ICONS: Record<RoiTool, ReactNode> = {
  select_within: <SquareDashed size={18} />,
  zonal_elevation: <Sigma size={18} />,
  elevation_profile: <TrendingUp size={18} />,
  nearest: <LocateFixed size={18} />,
};

/** Grouped by what each tool needs from the ROI (spec §8, U-10). */
const GROUPS: { label: string; tools: RoiTool[] }[] = [
  { label: 'Vùng', tools: ['select_within', 'zonal_elevation'] },
  { label: 'Tuyến', tools: ['elevation_profile'] },
  { label: 'Lân cận', tools: ['nearest'] },
];

export interface AnalysisButtonsViewProps {
  active: RoiTool | null;
  availability: Record<RoiTool, Availability>;
  onOpen: (tool: RoiTool) => void;
}

/**
 * A disabled tool uses aria-disabled, not `disabled`: it stays focusable and hoverable, so
 * its reason is reachable, and pressing it shows the reason in the chip (U-2, NFR-4).
 */
export function AnalysisButtonsView({ active, availability, onOpen }: AnalysisButtonsViewProps) {
  return (
    <>
      {GROUPS.map((group, i) => (
        <Fragment key={group.label}>
          {i > 0 && <div className="control-divider" />}
          <div className="control-group" role="group" aria-label={group.label}>
            <span className="control-group-label" aria-hidden="true">{group.label}</span>
            {group.tools.map((tool) => {
              const a = availability[tool];
              const label = ANALYSIS_TOOL_LABELS[tool];
              return (
                <button
                  key={tool}
                  type="button"
                  className={`control-btn ${active === tool ? 'active' : ''}`}
                  aria-pressed={active === tool}
                  aria-disabled={!a.enabled}
                  aria-label={label}
                  title={a.enabled ? label : `${label} — ${a.reason}`}
                  onClick={() => onOpen(tool)}
                >
                  {ICONS[tool]}
                </button>
              );
            })}
          </div>
        </Fragment>
      ))}
    </>
  );
}
