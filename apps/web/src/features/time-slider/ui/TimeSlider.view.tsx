import type { KeyboardEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import { stepAtOrBefore, formatStepLocal } from '../model/timeSteps';
import type { TimeSpeed } from '../model/timeSlider.store';

export interface TimeSliderViewProps {
  steps: string[];
  time: string | null;
  playing: boolean;
  speed: TimeSpeed;
  onTime: (time: string) => void;
  onStep: (n: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onSpeed: (speed: TimeSpeed) => void;
}

const SPEEDS: TimeSpeed[] = [1, 2, 4];

/** The time bar along the bottom of the map, shared by every time-series layer. */
export function TimeSliderView(p: TimeSliderViewProps) {
  const at = p.time ? stepAtOrBefore(p.steps, p.time) : null;
  const index = at === null ? 0 : p.steps.indexOf(at);
  const text = p.time ? formatStepLocal(p.time) : '';

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    p.onStep(e.key === 'ArrowRight' ? 1 : -1);
  };

  return (
    <section className="time-slider" aria-label="Thanh thời gian">
      {p.playing ? (
        <button type="button" className="time-slider-play" aria-label="Tạm dừng" onClick={p.onPause}><Pause size={16} /></button>
      ) : (
        <button type="button" className="time-slider-play" aria-label="Phát" onClick={p.onPlay}><Play size={16} /></button>
      )}
      <div className="time-slider-speeds" role="group" aria-label="Tốc độ">
        {SPEEDS.map((s) => (
          <button key={s} type="button" aria-pressed={p.speed === s} onClick={() => p.onSpeed(s)}>{s}×</button>
        ))}
      </div>
      <input
        className="time-slider-range" type="range" min={0} max={Math.max(p.steps.length - 1, 0)} step={1} value={index}
        aria-label="Thời điểm" aria-valuetext={text}
        onKeyDown={onKeyDown}
        onChange={(e) => { const s = p.steps[Number(e.target.value)]; if (s) p.onTime(s); }}
      />
      <output className="time-slider-time">{text}</output>
    </section>
  );
}
