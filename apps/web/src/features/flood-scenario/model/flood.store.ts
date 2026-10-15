import { useSyncExternalStore } from 'react';
import type { FloodPlanRow, FloodScenarioDetail, FloodScenarioId } from '@webatlas/shared';
import * as api from '../api/flood.api';

export type FloodStatus = 'idle' | 'loading' | 'ready' | 'error';
export type FloodSpeed = 1 | 2 | 4;

export interface FloodState {
  scenarioId: FloodScenarioId | null;
  hour: number;
  playing: boolean;
  speed: FloodSpeed;
  planShown: boolean;
  status: FloodStatus;
  /** Frames preloaded so far. */
  loaded: number;
  error: string | null;
  detail: FloodScenarioDetail | null;
  roads: api.FloodRoadsCollection | null;
  plan: FloodPlanRow[] | null;
}

const INITIAL: FloodState = {
  scenarioId: null, hour: 0, playing: false, speed: 1, planShown: false, status: 'idle', loaded: 0,
  error: null, detail: null, roads: null, plan: null,
};

export interface FloodLoader {
  fetchScenario: typeof api.fetchScenario;
  fetchRoads: typeof api.fetchRoads;
  fetchPlan: typeof api.fetchPlan;
  preloadFrames: typeof api.preloadFrames;
}

/**
 * The open flood scenario and its playback. A module store, like roi.store.ts, so the dock, the
 * map layers and assistant commands all drive the same state.
 */
let state: FloodState = INITIAL;
const listeners = new Set<() => void>();
function publish(next: FloodState) { state = next; for (const l of listeners) l(); }
function update(patch: Partial<FloodState>) { publish({ ...state, ...patch }); }

let loader: FloodLoader = api;
let timer: ReturnType<typeof setInterval> | null = null;
/** Each open bumps this; a load for an older open is dropped. */
let seq = 0;

/** Tests only. */
export function setFloodLoader(l: FloodLoader): void { loader = l; }
/** Tests only. */
export function resetFloodStore(): void { stopTimer(); seq++; loader = api; publish(INITIAL); }

function stopTimer() { if (timer !== null) { clearInterval(timer); timer = null; } }

function clamp(hour: number): number {
  const max = state.detail?.hours ?? 0;
  return Math.min(Math.max(Math.trunc(hour), 0), max);
}

export async function openScenario(id: FloodScenarioId, hour?: number, playNow = false): Promise<void> {
  if (state.scenarioId === id && state.status === 'ready') {
    if (hour !== undefined) setHour(hour);
    if (playNow) play();
    return;
  }
  stopTimer();
  const mine = ++seq;
  update({ ...INITIAL, scenarioId: id, speed: state.speed, status: 'loading' });
  try {
    const [detail, roads] = await Promise.all([loader.fetchScenario(id), loader.fetchRoads(id)]);
    if (mine !== seq) return;
    update({ detail, roads });
    await loader.preloadFrames(id, detail.hours, (loaded) => { if (mine === seq) update({ loaded }); });
    if (mine !== seq) return;
    update({ status: 'ready', loaded: detail.hours + 1, hour: Math.min(Math.max(hour ?? detail.bulletinHour, 0), detail.hours) });
    if (playNow) play();
  } catch {
    if (mine !== seq) return;
    update({ status: 'error', error: 'Không tải được kịch bản lũ.' });
  }
}

export function setHour(hour: number): void { update({ hour: clamp(hour) }); }

export function tick(): void {
  if (!state.detail) return;
  const next = Math.min(state.hour + state.speed, state.detail.hours);
  const atEnd = next >= state.detail.hours;
  if (atEnd) stopTimer();
  update({ hour: next, playing: atEnd ? false : state.playing });
}

export function play(): void {
  if (state.status !== 'ready' || !state.detail) return;
  stopTimer();
  // From the last hour, play starts over.
  if (state.hour >= state.detail.hours) update({ hour: 0 });
  update({ playing: true });
  timer = setInterval(tick, 1000);
}

export function pause(): void { stopTimer(); update({ playing: false }); }
export function setSpeed(speed: FloodSpeed): void { update({ speed }); }

export async function showPlan(id: FloodScenarioId): Promise<void> {
  await openScenario(id);
  if (state.scenarioId !== id || state.status !== 'ready') return;
  try {
    const plan = await loader.fetchPlan(id);
    if (state.scenarioId === id) update({ plan, planShown: true });
  } catch {
    update({ error: 'Không tải được phương án sơ tán.' });
  }
}

export function closeScenario(): void { stopTimer(); seq++; publish({ ...INITIAL, speed: state.speed }); }

export function retry(): Promise<void> {
  const id = state.scenarioId;
  if (!id) return Promise.resolve();
  update({ status: 'idle' });
  return openScenario(id);
}

export function getFloodState(): FloodState { return state; }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useFloodScenario(): FloodState { return useSyncExternalStore(subscribe, getFloodState, getFloodState); }
