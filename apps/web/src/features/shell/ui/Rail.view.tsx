import { ChartNoAxesCombined, ListTree, MessageSquareText } from 'lucide-react';
import { IconButton } from '@/shared/ui/IconButton';

export interface RailViewProps {
  contentsOpen: boolean;
  onContents: () => void;
  forecastOpen: boolean;
  onForecast: () => void;
  /** null: no Trợ lý button (a visitor who is not signed in). */
  assistant: { open: boolean; onToggle: () => void } | null;
}

const BUTTON = 'size-control-sm border-transparent bg-transparent';

/**
 * The 34 px rail at the map's top-left (spec artboard 3b v2): Mục lục, Dự báo và phân tích and
 * Trợ lý, each pressed while its panel is open. The contents panel sits to its right.
 */
export function RailView({ contentsOpen, onContents, forecastOpen, onForecast, assistant }: RailViewProps) {
  return (
    <nav
      aria-label="Thanh bảng"
      data-slot="rail"
      className="absolute top-2 left-2 z-[15] flex w-[var(--contents-rail)] flex-col items-center gap-1 rounded-lg border border-solid border-line bg-surface py-0.5"
    >
      <IconButton label="Mục lục" side="right" aria-pressed={contentsOpen} onClick={onContents} className={BUTTON}>
        <ListTree size={16} aria-hidden="true" />
      </IconButton>
      <IconButton label="Dự báo và phân tích" side="right" aria-pressed={forecastOpen} onClick={onForecast} className={BUTTON}>
        <ChartNoAxesCombined size={16} aria-hidden="true" />
      </IconButton>
      {assistant && (
        <IconButton label="Trợ lý" side="right" aria-pressed={assistant.open} onClick={assistant.onToggle} className={BUTTON}>
          <MessageSquareText size={16} aria-hidden="true" />
        </IconButton>
      )}
    </nav>
  );
}
