import { pause, play, setSpeed, setTime, stepBy, useTimeSlider } from './model/timeSlider.store';
import { TimeSliderView } from './ui/TimeSlider.view';
import './ui/time-slider.css';

/** The shared time bar; nothing while no visible time-series layer supplies steps. */
export default function TimeSlider() {
  const s = useTimeSlider();
  if (s.steps.length === 0) return null;
  return (
    <TimeSliderView
      steps={s.steps} time={s.time} playing={s.playing} speed={s.speed}
      onTime={setTime} onStep={stepBy} onPlay={play} onPause={pause} onSpeed={setSpeed}
    />
  );
}
