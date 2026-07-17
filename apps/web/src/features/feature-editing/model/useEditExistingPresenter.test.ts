import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const enterEditMode = vi.fn(); const exitEditMode = vi.fn(); const startModify = vi.fn();
const cancelModify = vi.fn(); const clearSelection = vi.fn(); const refreshLayer = vi.fn();
vi.mock('../../map/model/mapEditing', () => ({
  useMapEditing: () => ({ enterEditMode, exitEditMode, startModify, cancelModify, clearSelection, refreshLayer,
    hasMap: true, startDraw: vi.fn(), cancelDraw: vi.fn(), registerRefresh: vi.fn(), editing: false }),
}));
const deleteFeature = vi.fn();
vi.mock('../api/features.api', () => ({ deleteFeature: (...a: unknown[]) => deleteFeature(...a), createFeature: vi.fn(), updateFeature: vi.fn() }));
import { useEditExistingPresenter } from './useEditExistingPresenter';

describe('useEditExistingPresenter', () => {
  beforeEach(() => { enterEditMode.mockReset(); exitEditMode.mockReset(); startModify.mockReset(); deleteFeature.mockReset(); refreshLayer.mockReset(); });

  it('enter() activates edit mode', () => {
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => result.current.enter());
    expect(enterEditMode).toHaveBeenCalledWith(expect.any(Function));
    expect(result.current.editMode).toBe(true);
  });

  it('on selection: builds DB-keyed attributes + prefilled values and starts modify', () => {
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => result.current.enter());
    const onSelected = enterEditMode.mock.calls[0][0];
    act(() => onSelected({ layerKey: 'dams', featureId: 'f1',
      geometry: { type: 'Point', coordinates: [108, 13] },
      isoProps: { geographicalName: 'Hoa Binh', operationalStatus: 'Bình thường', layerKey: 'dams' } }));
    expect(result.current.selection?.featureId).toBe('f1');
    expect(result.current.selection?.attributes).toContain('name');   // DB column
    expect(result.current.selection?.initialValues.name).toBe('Hoa Binh');
    expect(result.current.workingGeometry).toEqual({ type: 'Point', coordinates: [108, 13] });
    expect(startModify).toHaveBeenCalledWith(expect.any(Function));
  });

  it('confirmDelete deletes the selected feature, refetches, and resets', async () => {
    deleteFeature.mockResolvedValue(undefined);
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => result.current.enter());
    const onSelected = enterEditMode.mock.calls[0][0];
    act(() => onSelected({ layerKey: 'dams', featureId: 'f1', geometry: { type: 'Point', coordinates: [108, 13] }, isoProps: {} }));
    act(() => result.current.requestDelete());
    expect(result.current.confirmOpen).toBe(true);
    await act(async () => { await result.current.confirmDelete(); });
    expect(deleteFeature).toHaveBeenCalledWith('dams', 'f1');
    expect(refreshLayer).toHaveBeenCalled();
    expect(result.current.selection).toBeNull();
  });

  it('exit() leaves edit mode and clears selection', () => {
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => result.current.enter());
    act(() => result.current.exit());
    expect(exitEditMode).toHaveBeenCalled();
    expect(result.current.editMode).toBe(false);
    expect(result.current.selection).toBeNull();
  });
});
