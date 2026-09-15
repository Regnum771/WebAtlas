import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { fromLonLat } from 'ol/proj';
import { elevationCacheKey, useCursorElevation, SETTLE_MS } from './useCursorElevation';

vi.mock('../api/elevation.api', () => ({ fetchElevation: vi.fn() }));
import { fetchElevation } from '../api/elevation.api';

const mocked = () => fetchElevation as ReturnType<typeof vi.fn>;

/** Minimal stand-in for an OpenLayers map: the hook only ever uses on/un('pointermove'). */
function fakeMap() {
  const handlers = new Set<(e: unknown) => void>();
  return {
    map: {
      on: (_t: string, h: (e: unknown) => void) => handlers.add(h),
      un: (_t: string, h: (e: unknown) => void) => handlers.delete(h),
    },
    move(lon: number, lat: number, dragging = false) {
      const coordinate = fromLonLat([lon, lat]);
      handlers.forEach((h) => h({ coordinate, dragging }));
    },
    get listenerCount() {
      return handlers.size;
    },
  };
}

const BMT: [number, number] = [108.0447, 12.6797];

/**
 * Let the debounce fire and the resulting fetch settle.
 *
 * Not `waitFor`: it polls on real timers, which never advance under
 * vi.useFakeTimers(), so every assertion after a fetch would sit there until the 5 s
 * test timeout. Advancing the clock inside act() and then draining the microtask queue
 * is the deterministic equivalent — the two awaits cover the promise chain in the
 * timeout callback (fetch resolve, then setState).
 */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(SETTLE_MS);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('elevationCacheKey', () => {
  it('collapses coordinates finer than the DEM grid onto one key', () => {
    // 4 decimals is ~11 m; the DEM is a 30 m grid, so two points this close are the same
    // pixel and must not cost two requests.
    expect(elevationCacheKey(108.04471, 12.67972)).toBe(elevationCacheKey(108.04474, 12.67969));
  });

  it('keeps genuinely different places apart', () => {
    expect(elevationCacheKey(108.0447, 12.6797)).not.toBe(elevationCacheKey(108.4244, 12.4061));
  });
});

describe('useCursorElevation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('asks for nothing until the cursor has settled', async () => {
    // The whole point of the debounce: the global API rate limit is 100/min, and a plain
    // per-move fetch would burn it in seconds.
    mocked().mockResolvedValue({ status: 'ok', elevationM: 473.9, source: 'Copernicus GLO-30' });
    const f = fakeMap();
    renderHook(() => useCursorElevation(f.map as never));

    act(() => {
      for (let i = 0; i < 50; i++) f.move(108.04 + i * 0.001, 12.67);
    });
    expect(mocked()).not.toHaveBeenCalled();

    await settle();
    expect(mocked()).toHaveBeenCalledTimes(1);
  });

  it('reports the elevation once it arrives', async () => {
    mocked().mockResolvedValue({ status: 'ok', elevationM: 473.9, source: 'Copernicus GLO-30' });
    const f = fakeMap();
    const { result } = renderHook(() => useCursorElevation(f.map as never));

    act(() => f.move(...BMT));
    await settle();

    expect(result.current.elevationM).toBe(473.9);
    expect(result.current.pending).toBe(false);
  });

  it('serves a revisited point from cache without a second request', async () => {
    mocked().mockResolvedValue({ status: 'ok', elevationM: 473.9, source: 'Copernicus GLO-30' });
    const f = fakeMap();
    const { result } = renderHook(() => useCursorElevation(f.map as never));

    act(() => f.move(...BMT));
    await settle();
    expect(result.current.elevationM).toBe(473.9);

    act(() => f.move(108.04472, 12.67971)); // same DEM pixel
    await settle();
    expect(mocked()).toHaveBeenCalledTimes(1);
    expect(result.current.elevationM).toBe(473.9);
  });

  it('ignores movement while the map is being dragged', async () => {
    mocked().mockResolvedValue({ status: 'ok', elevationM: 1, source: 'x' });
    const f = fakeMap();
    renderHook(() => useCursorElevation(f.map as never));

    act(() => f.move(108.1, 12.1, true));
    await settle();
    expect(mocked()).not.toHaveBeenCalled();
  });

  it('stops asking entirely once the server says the DEM is not loaded', async () => {
    // That answer cannot change mid-session, so continuing to ask spends requests to be
    // told "no" repeatedly — on exactly the boxes that have not run the runbook.
    mocked().mockResolvedValue({ status: 'unavailable', elevationM: null, source: null });
    const f = fakeMap();
    const { result } = renderHook(() => useCursorElevation(f.map as never));

    act(() => f.move(...BMT));
    await settle();
    expect(result.current.unavailable).toBe(true);

    act(() => f.move(108.5, 13.5));
    await settle();
    expect(mocked()).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the request fails', async () => {
    mocked().mockRejectedValue(new Error('network'));
    const f = fakeMap();
    const { result } = renderHook(() => useCursorElevation(f.map as never));

    act(() => f.move(...BMT));
    await settle();

    expect(result.current.pending).toBe(false);
    expect(result.current.elevationM).toBeNull();
  });

  it('detaches its listener on unmount', () => {
    const f = fakeMap();
    const { unmount } = renderHook(() => useCursorElevation(f.map as never));
    expect(f.listenerCount).toBe(1);
    unmount();
    expect(f.listenerCount).toBe(0);
  });
});
