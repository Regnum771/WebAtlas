import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImpactsSummary } from './useImpactsSummary';

const totals = { roadsCut: 1, roadsCutKm: 2, wardsWet: 3, buildingsFlooded: 4, peopleEst: 16 };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useImpactsSummary', () => {
  it('asks once after the slider settles, not once per hour dragged past', async () => {
    const fetch = vi.fn(async () => ({ hour: 0, time: '', roads: [], wards: [], totals }));
    const { result, rerender } = renderHook(({ hour }) => useImpactsSummary('kttv-2025-10', true, hour, fetch), { initialProps: { hour: 0 } });
    for (let h = 1; h <= 50; h++) rerender({ hour: h });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('kttv-2025-10', 50);
    expect(result.current).toEqual(totals);
  });

  it('is empty while the scenario is not ready', async () => {
    const fetch = vi.fn();
    const { result } = renderHook(() => useImpactsSummary('kttv-2025-10', false, 10, fetch));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
