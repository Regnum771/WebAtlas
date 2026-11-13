import { forwardRef } from 'react';
import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { IconButton } from '@/shared/ui/IconButton';
import { Slider } from '@/shared/ui/shadcn/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/shadcn/select';
import type { StepSize, TimeRowModel } from '../model/timeRowModel';

export interface TimeRowViewProps {
  model: TimeRowModel;
  onIndex: (index: number) => void;
  /** -1 or +1: one step size back or forward. */
  onStep: (direction: -1 | 1) => void;
  onPlay: () => void;
  onPause: () => void;
  onStepSize: (size: StepSize) => void;
  onClose: () => void;
  /** The × button's name: what closing does for this source. */
  closeLabel: string;
}

const SIZES: StepSize[] = [1, 2, 4];
const BUTTON = 'size-control-sm';

/**
 * The time row (R8): directly above the status bar, the map's full width, while a time layer is
 * on. Step back, play, step forward; the current time; the track with day ticks, the observed and
 * forecast segments and the issue-time mark; the step-size picker; and × to close it.
 */
export const TimeRowView = forwardRef<HTMLElement, TimeRowViewProps>(function TimeRowView(
  { model, onIndex, onStep, onPlay, onPause, onStepSize, onClose, closeLabel }, ref,
) {
  const max = Math.max(model.count - 1, 1);
  const pct = (i: number) => `${(i / max) * 100}%`;
  const time = model.label(model.index);
  const issue = model.issueIndex;

  return (
    <section
      ref={ref}
      aria-label="Hàng thời gian"
      data-slot="time-row"
      className="absolute right-0 bottom-8 left-0 z-[16] flex h-[var(--time-row-size)] items-center gap-1.5 border-0 border-t border-solid border-line bg-surface px-2 text-body text-ink"
    >
      <IconButton label="Lùi một bước" side="top" className={BUTTON} onClick={() => onStep(-1)} disabled={model.index <= 0}>
        <SkipBack size={14} aria-hidden="true" />
      </IconButton>
      {model.playing ? (
        <IconButton label="Tạm dừng" side="top" className={BUTTON} onClick={onPause}><Pause size={14} aria-hidden="true" /></IconButton>
      ) : (
        <IconButton label="Phát" side="top" className={BUTTON} onClick={onPlay}><Play size={14} aria-hidden="true" /></IconButton>
      )}
      <IconButton label="Tiến một bước" side="top" className={BUTTON} onClick={() => onStep(1)} disabled={model.index >= model.count - 1}>
        <SkipForward size={14} aria-hidden="true" />
      </IconButton>
      <output aria-label="Thời điểm hiện tại" className="w-[136px] flex-none text-center font-num text-num">{time}</output>

      {/* A container, so a narrow track (the 600 px map at 1100 px with the dock) drops every other day label. */}
      <div className="@container relative h-full min-w-0 flex-1">
        {/* Observed up to the issue time, forecast after it (series-2 / series-1), named in words above. */}
        {issue !== null && (
          <>
            <span aria-hidden="true" className="absolute top-[19px] left-0 h-1 bg-series-2/45" style={{ width: pct(issue) }} title="Thực đo" />
            <span aria-hidden="true" className="absolute top-[19px] right-0 h-1 bg-series-1/45" style={{ left: pct(issue) }} title="Dự báo" />
            <span aria-hidden="true" className="absolute top-1 left-0 text-[10px] leading-none text-ink-2">thực đo</span>
            <span aria-hidden="true" className="absolute top-[13px] h-[18px] border-0 border-l-2 border-dashed border-ink-2" style={{ left: pct(issue) }} />
            <span aria-hidden="true" className="absolute top-1 pl-1 text-[10px] leading-none whitespace-nowrap text-ink-2" style={{ left: pct(issue) }}>
              phát hành · dự báo
            </span>
          </>
        )}
        <Slider
          className="absolute top-[13px] right-0 left-0"
          min={0} max={max} step={1} value={[model.index]}
          onValueChange={([v]) => onIndex(v)}
          thumbLabel="Thời điểm" thumbValueText={time}
        />
        <div aria-hidden="true" className="absolute right-0 bottom-0.5 left-0 h-3">
          {model.ticks.map((t, i) => (
            <span key={t.index} className={`absolute top-0 -translate-x-1/2 font-num text-[10px] leading-none text-ink-2${i % 2 === 1 ? ' @max-[320px]:hidden' : ''}`} style={{ left: pct(t.index) }}>
              {t.label}
            </span>
          ))}
        </div>
        {issue !== null && <span className="sr-only">Phát hành lúc {model.label(issue)}; trước đó là thực đo, sau đó là dự báo.</span>}
      </div>

      <Select value={String(model.stepSize)} onValueChange={(v) => onStepSize(Number(v) as StepSize)}>
        <SelectTrigger aria-label="Bước mỗi giây" className="w-[96px] flex-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n} {model.stepUnit}/giây</SelectItem>)}
        </SelectContent>
      </Select>
      <IconButton label={closeLabel} side="top" className={`${BUTTON} border-transparent bg-transparent`} onClick={onClose}>
        <X size={14} aria-hidden="true" />
      </IconButton>
    </section>
  );
});
