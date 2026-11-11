import { useEffect } from 'react';
import { pause, play, setSpeed, setTime, stepBy, useTimeSlider } from './model/timeSlider.store';
import { watchFloodDock } from './model/floodDockHeight';
import { TimeSliderView } from './ui/TimeSlider.view';
import './ui/time-slider.css';

/** The shared time bar; nothing while no visible time-series layer supplies steps. */
export default function TimeSlider() {
  const s = useTimeSlider();
  const shown = s.steps.length > 0;
  // Keep clear of the flood dock: its measured height is published on the map stage.
  useEffect(() => {
    if (!shown) return;
    const stage = document.querySelector<HTMLElement>('.map-stage-map');
    if (!stage || typeof ResizeObserver === 'undefined') return;
    return watchFloodDock(stage);
  }, [shown]);
  if (!shown) return null;
  return (
    <TimeSliderView
      steps={s.steps} time={s.time} playing={s.playing} speed={s.speed}
      onTime={setTime} onStep={stepBy} onPlay={play} onPause={pause} onSpeed={setSpeed}
    />
  );
}
