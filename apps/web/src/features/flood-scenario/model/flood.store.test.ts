import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { FloodScenarioDetail } from '@webatlas/shared';
import {
  closeScenario, getFloodState, openScenario, pause, play, resetFloodStore, retry, setFloodLoader, setHour,
  setSpeed, showPlan, tick,
} from './flood.store';

function detail(id: FloodScenarioDetail['id']): FloodScenarioDetail {
  return {
    id, name: id, kind: 'kttv', rainTotalMm: null, startTime: '2025-10-27T14:00:00.000Z', hours: 96, bulletinHour: 24,
    basis: 'Mực nước thực đo KTTV', stations: [], series: {}, floodedKm2: [], frameExtent: [0, 0, 1, 1],
  };
}

const roads = { type: 'FeatureCollection', features: [] } as const;

function loader(overrides: Partial<Parameters<typeof setFloodLoader>[0]> = {}) {
  const l = {
    fetchScenario: vi.fn(async (id: FloodScenarioDetail['id']) => detail(id)),
    fetchRoads: vi.fn(async () => roads),
    fetchPlan: vi.fn(async () => []),
    preloadFrames: vi.fn(async (_id: string, hours: number, onProgress: (n: number) => void) => { onProgress(hours + 1); }),
    ...overrides,
  };
  setFloodLoader(l);
  return l;
}

beforeEach(() => { resetFloodStore(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('flood.store', () => {
  it('opens a scenario at its bulletin hour once every frame is preloaded', async () => {
    loader();
    await openScenario('kttv-2025-10');
    const s = getFloodState();
    expect(s.status).toBe('ready');
    expect(s.hour).toBe(24);
    expect(s.loaded).toBe(97);
    expect(s.playing).toBe(false);
  });

  it('reports progress while preloading', async () => {
    const seen: number[] = [];
    loader({ preloadFrames: vi.fn(async (_id: string, _h: number, onProgress: (n: number) => void) => {
      onProgress(10); seen.push(getFloodState().loaded); onProgress(97);
    }) });
    await openScenario('kttv-2025-10');
    expect(seen).toEqual([10]);
  });

  it('fails with a message when a frame cannot be preloaded, and retry tries again', async () => {
    const l = loader({ preloadFrames: vi.fn().mockRejectedValueOnce(new Error('404')).mockResolvedValue(undefined) });
    await openScenario('kttv-2025-10');
    expect(getFloodState().status).toBe('error');
    expect(getFloodState().error).toBe('Không tải được kịch bản lũ.');
    await retry();
    expect(l.preloadFrames).toHaveBeenCalledTimes(2);
    expect(getFloodState().status).toBe('ready');
  });

  it('clamps the hour to the scenario', async () => {
    loader();
    await openScenario('kttv-2025-10');
    setHour(500);
    expect(getFloodState().hour).toBe(96);
    setHour(-3);
    expect(getFloodState().hour).toBe(0);
  });

  it('advances by the speed each tick and pauses at the last hour', async () => {
    loader();
    await openScenario('kttv-2025-10', 94);
    setSpeed(4);
    play();
    tick();
    expect(getFloodState().hour).toBe(96);
    expect(getFloodState().playing).toBe(false);
  });

  it('plays on a one-second timer until paused', async () => {
    loader();
    await openScenario('kttv-2025-10', 10);
    play();
    vi.advanceTimersByTime(3000);
    expect(getFloodState().hour).toBe(13);
    pause();
    vi.advanceTimersByTime(3000);
    expect(getFloodState().hour).toBe(13);
  });

  it('switching scenario while playing stops playback and goes to the bulletin hour', async () => {
    loader();
    await openScenario('kttv-2025-10', 60);
    play();
    await openScenario('preset-1300');
    const s = getFloodState();
    expect(s.scenarioId).toBe('preset-1300');
    expect(s.playing).toBe(false);
    expect(s.hour).toBe(24);
    expect(s.planShown).toBe(false);
  });

  it('reopening the open scenario only moves the hour', async () => {
    const l = loader();
    await openScenario('kttv-2025-10');
    await openScenario('kttv-2025-10', 40);
    expect(getFloodState().hour).toBe(40);
    expect(l.preloadFrames).toHaveBeenCalledTimes(1);
  });

  it('shows the plan for a scenario, opening it first if needed', async () => {
    const l = loader();
    await showPlan('preset-500');
    expect(getFloodState().scenarioId).toBe('preset-500');
    expect(getFloodState().planShown).toBe(true);
    expect(l.fetchPlan).toHaveBeenCalledWith('preset-500');
  });

  it('closing stops playback and clears the scenario', async () => {
    loader();
    await openScenario('kttv-2025-10');
    play();
    closeScenario();
    expect(getFloodState().scenarioId).toBeNull();
    expect(getFloodState().playing).toBe(false);
  });
});
