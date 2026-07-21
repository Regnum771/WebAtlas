import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditExistingPresenter } from './useEditExistingPresenter';

const startModify = vi.fn();
const cancelModify = vi.fn();
const refreshLayer = vi.fn();
const clearSelection = vi.fn();

let currentSelection: unknown = null;

vi.mock('../../map/model/mapEditing', () => ({
  useMapEditing: () => ({ startModify, cancelModify, refreshLayer }),
}));

vi.mock('../../../entities/selection', () => ({
  useSelection: () => ({ selection: currentSelection, clear: clearSelection }),
}));

const damSelection = {
  layerKey: 'dams',
  featureId: 'a1',
  feature: { fake: 'feature' },
  isoProps: { geographicalName: 'Hoa Binh' },
};

beforeEach(() => {
  vi.clearAllMocks();
  currentSelection = null;
});

describe('useEditExistingPresenter', () => {
  it('is not editing initially and starts no modify interaction', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());

    expect(result.current.editing).toBe(false);
    expect(startModify).not.toHaveBeenCalled();
  });

  it('beginEdit starts geometry modification for the selected feature', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());

    act(() => { result.current.beginEdit(); });

    expect(result.current.editing).toBe(true);
    expect(startModify).toHaveBeenCalled();
  });

  it('beginEdit exposes the selection as form values keyed by db column', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());

    act(() => { result.current.beginEdit(); });

    expect(result.current.selection?.featureId).toBe('a1');
    expect(result.current.selection?.attributes.length).toBeGreaterThan(0);
    expect(result.current.selection?.initialValues).toBeDefined();
  });

  it('beginEdit does nothing when nothing is selected', () => {
    currentSelection = null;
    const { result } = renderHook(() => useEditExistingPresenter());

    act(() => { result.current.beginEdit(); });

    expect(result.current.editing).toBe(false);
    expect(startModify).not.toHaveBeenCalled();
  });

  it('cancelEdit stops modification but leaves the selection alone', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => { result.current.beginEdit(); });

    act(() => { result.current.cancelEdit(); });

    expect(result.current.editing).toBe(false);
    expect(cancelModify).toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
  });

  it('onSaved refreshes the layer and leaves edit mode', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => { result.current.beginEdit(); });

    act(() => { result.current.onSaved(); });

    expect(refreshLayer).toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });
});
