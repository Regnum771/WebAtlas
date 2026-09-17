import type { ReactNode } from 'react';
import { CircleDashed, SquareDashed, LocateFixed, TrendingUp, Sigma } from 'lucide-react';
import { ANALYSIS_OPS, type AnalysisOp } from '@webatlas/shared';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';

const ICONS: Record<AnalysisOp, ReactNode> = {
  buffer: <CircleDashed size={18} />,
  select_within: <SquareDashed size={18} />,
  nearest: <LocateFixed size={18} />,
  elevation_profile: <TrendingUp size={18} />,
  zonal_elevation: <Sigma size={18} />,
};

export function AnalysisButtonsView({ active, onOpen }: { active: AnalysisOp | null; onOpen: (op: AnalysisOp) => void }) {
  return (
    <div className="control-group" role="group" aria-label="Phân tích">
      {ANALYSIS_OPS.map((op) => (
        <button
          key={op}
          type="button"
          className={`control-btn ${active === op ? 'active' : ''}`}
          aria-pressed={active === op}
          onClick={() => onOpen(op)}
          title={ANALYSIS_TOOL_LABELS[op]}
          aria-label={ANALYSIS_TOOL_LABELS[op]}
        >
          {ICONS[op]}
        </button>
      ))}
    </div>
  );
}
