import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditExistingPresenter } from './useEditExistingPresenter';

const startModify = vi.fn();
const cancelModify = vi.fn();
const refreshLayer = vi.fn();
const clearSelection = vi.fn();
const deleteFeature = vi.fn();

let currentSelection: unknown = null;

vi.mock('../../map/model/mapEditing', () => ({
  useMapEditing: () => ({ startModify, cancelModify, refreshLayer }),
}));

vi.mock('../../../entities/selection', () => ({
  useSelection: () => ({
    selection: currentSelection,
    clear: () => {
      clearSelection();
      currentSelection = null;
    },
  }),
}));

vi.mock('../api/features.api', () => ({
  deleteFeature: (...args: unknown[]) => deleteFeature(...args),
}));

vi.mock('../../map/model/geo', () => ({
  olGeometryTo4326GeoJSON: () => ({ type: 'Point', coordinates: [108, 13] }),
}));

const damSelection = {
  layerKey: 'dams',
  featureId: 'a1',
  feature: { getGeometry: () => ({ fake: 'geometry' }) },
  isoProps: { geographicalName: 'Hoa Binh' },
};

const damSelectionNoGeometry = {
  layerKey: 'dams',
  featureId: 'a2',
  feature: { getGeometry: () => undefined },
  isoProps: { geographicalName: 'No Geometry Dam' },
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

  it('beginEdit refuses to enter edit mode when the feature has no readable geometry', () => {
    currentSelection = damSelectionNoGeometry;
    const { result } = renderHook(() => useEditExistingPresenter());

    act(() => { result.current.beginEdit(); });

    expect(result.current.editing).toBe(false);
    expect(result.current.selection).toBeNull();
    expect(startModify).not.toHaveBeenCalled();
  });

  it('cancelEdit stops modification but leaves the shared selection usable', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => { result.current.beginEdit(); });

    act(() => { result.current.cancelEdit(); });

    expect(result.current.editing).toBe(false);
    expect(cancelModify).toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();

    // The real guarantee: cancelEdit must not clear the shared map selection, so
    // beginEdit can be invoked again immediately and still finds the same feature.
    act(() => { result.current.beginEdit(); });
    expect(result.current.editing).toBe(true);
    expect(result.current.selection?.featureId).toBe('a1');
  });

  it('onSaved refreshes the layer and leaves edit mode', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => { result.current.beginEdit(); });

    act(() => { result.current.onSaved(); });

    expect(refreshLayer).toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it('confirmDelete deletes the selected feature, refreshes the layer, and resets', async () => {
    deleteFeature.mockResolvedValue(undefined);
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => { result.current.beginEdit(); });

    act(() => { result.current.requestDelete(); });
    expect(result.current.confirmOpen).toBe(true);

    await act(async () => { await result.current.confirmDelete(); });

    expect(deleteFeature).toHaveBeenCalledWith('dams', 'a1');
    expect(refreshLayer).toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
    expect(result.current.selection).toBeNull();
    expect(result.current.deleting).toBe(false);
    expect(result.current.confirmOpen).toBe(false);
  });

  it('confirmDelete sets an error and clears deleting when the delete request fails', async () => {
    deleteFeature.mockRejectedValue(new Error('network down'));
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => { result.current.beginEdit(); });

    act(() => { result.current.requestDelete(); });

    await act(async () => { await result.current.confirmDelete(); });

    expect(deleteFeature).toHaveBeenCalledWith('dams', 'a1');
    expect(refreshLayer).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Could not delete — please try again');
    expect(result.current.deleting).toBe(false);
  });

  it('cancelDelete closes the confirmation dialog without deleting', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => { result.current.beginEdit(); });

    act(() => { result.current.requestDelete(); });
    expect(result.current.confirmOpen).toBe(true);

    act(() => { result.current.cancelDelete(); });

    expect(result.current.confirmOpen).toBe(false);
    expect(deleteFeature).not.toHaveBeenCalled();
  });
});
