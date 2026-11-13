import { formatScenarioTime } from '@webatlas/shared';
import type { FloodState } from '../../flood-scenario/model/flood.store';
import { dayLabel, midnightHours } from '../../flood-scenario/model/scenarioTime';
import type { TimeSliderState } from '../../time-slider/model/timeSlider.store';
import { formatStepLocal, stepAtOrBefore } from '../../time-slider/model/timeSteps';

export type StepSize = 1 | 2 | 4;

/** What the time row shows, whichever source drives it (K4 plan, decision 8). */
export interface TimeRowModel {
  source: 'scenario' | 'layers';
  /** Steps on the track: hours of the scenario, or the time layers' steps. */
  count: number;
  index: number;
  /** The time of a step, as the row writes it. */
  label: (index: number) => string;
  /** Day ticks under the track. */
  ticks: { index: number; label: string }[];
  /** The forecast's issue time, marked on the track; null for a source without one. */
  issueIndex: number | null;
  playing: boolean;
  stepSize: StepSize;
  /** What one step is: "giờ" for the scenario's hours, "bước" for the layers' steps. */
  stepUnit: string;
  /** Identifies the layers' set of steps, so a row hidden with × comes back when it changes. */
  signature: string;
}

/** At most this many day labels under the track; more are thinned to every k-th. */
const MAX_TICKS = 12;

function thin<T>(ticks: T[]): T[] {
  if (ticks.length <= MAX_TICKS) return ticks;
  const k = Math.ceil(ticks.length / MAX_TICKS);
  return ticks.filter((_, i) => i % k === 0);
}

/** The open flood scenario, once it is ready. */
export function scenarioModel(s: FloodState): TimeRowModel | null {
  if (!s.scenarioId || s.status !== 'ready' || !s.detail) return null;
  const { startTime, hours, bulletinHour } = s.detail;
  return {
    source: 'scenario',
    count: hours + 1,
    index: s.hour,
    label: (i) => formatScenarioTime(startTime, i),
    ticks: thin(midnightHours(startTime, hours).map((h) => ({ index: h, label: dayLabel(startTime, h) }))),
    issueIndex: bulletinHour,
    playing: s.playing,
    stepSize: s.speed,
    stepUnit: 'giờ',
    signature: `scenario:${s.scenarioId}`,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The time layers on the map (S1), while any supplies steps. */
export function layersModel(s: TimeSliderState): TimeRowModel | null {
  if (s.steps.length === 0) return null;
  const at = s.time ? stepAtOrBefore(s.steps, s.time) : null;
  const ticks: { index: number; label: string }[] = [];
  let lastDay = '';
  s.steps.forEach((iso, i) => {
    const d = new Date(iso);
    const day = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    if (day !== lastDay) { ticks.push({ index: i, label: day }); lastDay = day; }
  });
  return {
    source: 'layers',
    count: s.steps.length,
    index: at === null ? 0 : s.steps.indexOf(at),
    label: (i) => formatStepLocal(s.steps[i] ?? s.steps[0]),
    // A single day says nothing as a tick.
    ticks: ticks.length > 1 ? thin(ticks) : [],
    issueIndex: null,
    playing: s.playing,
    stepSize: s.speed,
    stepUnit: 'bước',
    signature: `layers:${s.steps[0]}:${s.steps[s.steps.length - 1]}:${s.steps.length}`,
  };
}
