import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { AnalysisResult, GeoJsonGeometry } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { useAnalysis } from './useAnalysis';
import { getAnalysisResult, setAnalysisResult } from './analysisResult.store';

const poly: GeoJsonGeometry = { type: 'Polygon', coordinates: [[[108, 12], [108.1, 12], [108.1, 12.1], [108, 12]]] };
const RESULT: AnalysisResult = {
  op: 'select_within', summary: { 'Tổng số': 2 }, rows: [],
  geometries: [{ geometry: poly, role: 'input' }],
};

function setup(lastShape: GeoJsonGeometry | null = null) {
  let finish: ((g: GeoJsonGeometry) => void) | null = null;
  const stop = vi.fn();
  const deps = {
    startDraw: vi.fn((_kind, onDone) => { finish = onDone; return stop; }),
    run: vi.fn(),
    getLastShape: () => lastShape,
    fetchResult: vi.fn().mockResolvedValue(RESULT),
  };
  const hook = renderHook(() => useAnalysis(deps));
  return { hook, deps, stop, finish: (g: GeoJsonGeometry) => finish!(g) };
}

beforeEach(() => setAnalysisResult(null));

describe('useAnalysis', () => {
  it('open → draw → result draws geometries, fits and publishes the result', async () => {
    const { hook, deps, stop, finish } = setup();
    act(() => hook.result.current.open('select_within'));
    expect(hook.result.current.status).toBe('params');
    act(() => hook.result.current.draw());
    expect(deps.startDraw).toHaveBeenCalledWith('Polygon', expect.any(Function));
    expect(hook.result.current.status).toBe('drawing');
    await act(async () => finish(poly));
    expect(stop).toHaveBeenCalled();
    expect(deps.fetchResult).toHaveBeenCalledWith('select_within', { geometry: poly, layerKeys: ['dams'] });
    expect(deps.run).toHaveBeenCalledWith({ kind: 'showGeometries', items: RESULT.geometries, fit: true });
    expect(hook.result.current.result).toBe(RESULT);
    expect(getAnalysisResult()).toBe(RESULT);
  });

  it('reuses the last drawn shape when it fits, and explains when it does not', async () => {
    const { hook, deps } = setup(poly);
    act(() => hook.result.current.open('nearest'));
    await act(async () => hook.result.current.useLastShape());
    expect(deps.fetchResult).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe('Hình vừa vẽ không dùng được cho phép này — hãy vẽ mới.');
    act(() => hook.result.current.open('zonal_elevation'));
    await act(async () => hook.result.current.useLastShape());
    expect(deps.fetchResult).toHaveBeenCalledWith('zonal_elevation', { geometry: poly });
  });

  it('shows the API message on failure and returns to params', async () => {
    const { hook, deps, finish } = setup();
    deps.fetchResult.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'Vùng quá lớn'));
    act(() => hook.result.current.open('zonal_elevation'));
    act(() => hook.result.current.draw());
    await act(async () => finish(poly));
    expect(hook.result.current.error).toBe('Vùng quá lớn');
    expect(hook.result.current.status).toBe('params');
  });

  it('clear removes drawn results and the published result', async () => {
    const { hook, deps, finish } = setup();
    act(() => hook.result.current.open('select_within'));
    act(() => hook.result.current.draw());
    await act(async () => finish(poly));
    act(() => hook.result.current.clear());
    expect(deps.run).toHaveBeenCalledWith({ kind: 'clearHighlights' });
    expect(hook.result.current.result).toBeNull();
    expect(getAnalysisResult()).toBeNull();
  });
});
