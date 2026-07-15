import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock the OL DrawController so this bridge test needs no real map.
const startDraw = vi.fn();
const cancel = vi.fn();
const dispose = vi.fn();
vi.mock('./DrawController', () => ({
  DrawController: vi.fn().mockImplementation(() => ({ startDraw, cancel, dispose })),
}));

// Mock the map context to supply a fake non-null map.
const fakeMap = {} as unknown;
vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ map: fakeMap }),
}));

const activate = vi.fn(); const deactivate = vi.fn(); const getSelectedFeature = vi.fn(() => ({} as never)); const selClear = vi.fn();
vi.mock('./SelectController', () => ({
  SelectController: vi.fn().mockImplementation(() => ({ activate, deactivate, getSelectedFeature, clear: selClear, dispose: vi.fn() })),
}));
const modStart = vi.fn(); const modCancel = vi.fn();
vi.mock('./ModifyController', () => ({
  ModifyController: vi.fn().mockImplementation(() => ({ start: modStart, cancel: modCancel, dispose: vi.fn() })),
}));

import { MapEditingProvider, useMapEditing } from './mapEditing';

const wrapper = ({ children }: { children: ReactNode }) => <MapEditingProvider>{children}</MapEditingProvider>;

describe('useMapEditing', () => {
  beforeEach(() => { startDraw.mockReset(); cancel.mockReset(); });

  it('reports hasMap true when a map is present', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    expect(result.current.hasMap).toBe(true);
  });

  it('delegates startDraw and cancelDraw to the DrawController', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    const onFinish = vi.fn();
    act(() => result.current.startDraw('Point', onFinish));
    expect(startDraw).toHaveBeenCalledWith('Point', onFinish);
    act(() => result.current.cancelDraw());
    expect(cancel).toHaveBeenCalled();
  });

  it('refreshLayer calls the registered refresh function', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    const refresh = vi.fn();
    act(() => result.current.registerRefresh(refresh));
    act(() => result.current.refreshLayer('layer_dams'));
    expect(refresh).toHaveBeenCalledWith('layer_dams');
  });
});

describe('useMapEditing edit-existing', () => {
  beforeEach(() => { activate.mockReset(); deactivate.mockReset(); modStart.mockReset(); modCancel.mockReset(); });

  it('enterEditMode activates select and sets editing true; exit deactivates', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    const onSel = vi.fn();
    act(() => result.current.enterEditMode(onSel));
    expect(activate).toHaveBeenCalledWith(onSel);
    expect(result.current.editing).toBe(true);
    act(() => result.current.exitEditMode());
    expect(deactivate).toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it('startModify starts ModifyController on the selected feature', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    const onChange = vi.fn();
    act(() => result.current.startModify(onChange));
    expect(modStart).toHaveBeenCalled();
  });
});
