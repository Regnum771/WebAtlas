import { useSyncExternalStore } from 'react';
import { stepAtOrBefore } from './timeSteps';

export type TimeSpeed = 1 | 2 | 4;

export interface TimeSliderState {
  steps: string[];
  time: string | null;
  playing: boolean;
  speed: TimeSpeed;
}

const INITIAL: TimeSliderState = { steps: [], time: null, playing: false, speed: 1 };

/** The shared time of the time-series layers on the map. A module store, like flood.store.ts. */
let state: TimeSliderState = INITIAL;
const listeners = new Set<() => void>();
function publish(next: TimeSliderState) { state = next; for (const l of listeners) l(); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

let timer: ReturnType<typeof setInterval> | null = null;
function stopTimer() { if (timer !== null) { clearInterval(timer); timer = null; } }

export function getTimeSlider(): TimeSliderState { return state; }
export function useTimeSlider(): TimeSliderState { return useSyncExternalStore(subscribe, getTimeSlider); }
/** Test helper. */
export function resetTimeSlider(): void { stopTimer(); publish(INITIAL); }

function sameSteps(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** `steps` are sorted and unique (unionSteps). The time stays while within [first, last], else it goes to the first step. */
export function setSteps(steps: string[]): void {
  if (sameSteps(state.steps, steps)) return;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const t = state.time ? Date.parse(state.time) : NaN;
  const keep = state.time !== null && steps.length > 0 && t >= Date.parse(first) && t <= Date.parse(last);
  const time = keep ? state.time : (first ?? null);
  if (steps.length === 0) stopTimer();
  publish({ ...state, steps, time, playing: steps.length === 0 ? false : state.playing });
}

export function setTime(time: string): void { publish({ ...state, time }); }

/** Index of the step at or before the current time (0 when none). */
function currentIndex(): number {
  if (!state.time) return 0;
  const at = stepAtOrBefore(state.steps, state.time);
  return at === null ? 0 : state.steps.indexOf(at);
}

export function stepBy(n: number): void {
  if (state.steps.length === 0) return;
  const i = Math.min(Math.max(currentIndex() + n, 0), state.steps.length - 1);
  publish({ ...state, time: state.steps[i] });
}

function tick() {
  const last = state.steps.length - 1;
  if (last < 0) { pause(); return; }
  const i = Math.min(currentIndex() + 1, last);
  const atEnd = i >= last;
  if (atEnd) stopTimer();
  publish({ ...state, time: state.steps[i], playing: atEnd ? false : state.playing });
}

function startTimer() { stopTimer(); timer = setInterval(tick, 1000 / state.speed); }

export function play(): void {
  if (state.steps.length === 0) return;
  // From the last step, play starts over.
  if (currentIndex() >= state.steps.length - 1) publish({ ...state, time: state.steps[0] });
  publish({ ...state, playing: true });
  startTimer();
}

export function pause(): void { stopTimer(); publish({ ...state, playing: false }); }

export function setSpeed(speed: TimeSpeed): void {
  publish({ ...state, speed });
  if (state.playing) startTimer();
}
