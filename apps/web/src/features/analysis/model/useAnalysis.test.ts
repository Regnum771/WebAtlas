import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { AnalysisResult, ResolvedRoi, Roi } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { useAnalysis } from './useAnalysis';
import { getAnalysisResult, setAnalysisResult } from './analysisResult.store';

const roi: Roi = { source: 'admin', level: 'province', code: '66' };
const resolved: ResolvedRoi = {
  label: 'Tỉnh Đắk Lắk', kind: 'area', measure: { areaKm2: 18086 },
  display: { type: 'Point', coordinates: [108, 12.7] }, bbox: [107, 12, 109, 13.5], centroid: [108, 12.7],
};
const RESULT: AnalysisResult = {
  op: 'select_within', summary: { 'Tổng số': 2 }, rows: [],
  geometries: [{ geometry: { type: 'Point', coordinates: [108, 12.7] }, role: 'input' }],
};

function setup(current: { roi: Roi | null; resolved: ResolvedRoi | null } = { roi, resolved }) {
  const deps = {
    run: vi.fn(),
    fetchResult: vi.fn().mockResolvedValue(RESULT),
    getRoi: () => current,
    onUnavailable: vi.fn(),
  };
  const hook = renderHook(() => useAnalysis(deps));
  return { hook, deps };
}

beforeEach(() => setAnalysisResult(null));

describe('useAnalysis', () => {
  it('open → run sends the ROI, draws the result and names the ROI it answers', async () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.open('select_within'));
    expect(hook.result.current.status).toBe('params');
    await act(async () => hook.result.current.execute());
    expect(deps.fetchResult).toHaveBeenCalledWith('select_within', { roi, layerKeys: ['dams'] });
    expect(deps.run).toHaveBeenCalledWith({ kind: 'showGeometries', items: RESULT.geometries, fit: true });
    expect(hook.result.current.result).toBe(RESULT);
    expect(hook.result.current.resultRoiLabel).toBe('Tỉnh Đắk Lắk');
    expect(getAnalysisResult()).toBe(RESULT);
    expect(hook.result.current.active).toBeNull();
  });

  it('does not open a disabled tool: it reports the reason instead (U-2)', () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.open('elevation_profile'));
    expect(hook.result.current.active).toBeNull();
    expect(deps.onUnavailable).toHaveBeenCalledWith('Cần một đường, ví dụ một con sông');
  });

  it('with no ROI, every tool reports why', () => {
    const { hook, deps } = setup({ roi: null, resolved: null });
    act(() => hook.result.current.open('nearest'));
    expect(deps.onUnavailable).toHaveBeenCalledWith('Chưa có vùng phân tích');
  });

  it('shows the API message on failure and returns to params', async () => {
    const { hook, deps } = setup();
    deps.fetchResult.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'Vùng quá lớn'));
    act(() => hook.result.current.open('select_within'));
    await act(async () => hook.result.current.execute());
    expect(hook.result.current.error).toBe('Vùng quá lớn');
    expect(hook.result.current.status).toBe('params');
  });

  it('clear removes the result and its highlights', async () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.open('select_within'));
    await act(async () => hook.result.current.execute());
    act(() => hook.result.current.clear());
    expect(deps.run).toHaveBeenLastCalledWith({ kind: 'clearHighlights' });
    expect(hook.result.current.result).toBeNull();
  });
});
