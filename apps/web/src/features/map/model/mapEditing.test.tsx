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

// Mock the shared selection (Task 3/4) — mapEditing no longer owns its own Select;
// startModify reads the live feature off useSelection().selection.
let currentSelection: unknown = null;
vi.mock('../../../entities/selection', () => ({
  useSelection: () => ({ selection: currentSelection, selectById: vi.fn(), clear: vi.fn() }),
}));

const modStart = vi.fn(); const modCancel = vi.fn();
vi.mock('./ModifyController', () => ({
  ModifyController: vi.fn().mockImplementation(() => ({ start: modStart, cancel: modCancel, dispose: vi.fn() })),
}));

import { MapEditingProvider, useMapEditing } from './mapEditing';

const wrapper = ({ children }: { children: ReactNode }) => <MapEditingProvider>{children}</MapEditingProvider>;

describe('useMapEditing', () => {
  beforeEach(() => { startDraw.mockReset(); cancel.mockReset(); currentSelection = null; });

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

describe('useMapEditing startModify', () => {
  beforeEach(() => { modStart.mockReset(); modCancel.mockReset(); currentSelection = null; });

  it('starts ModifyController on the shared selection\'s live feature', () => {
    currentSelection = { layerKey: 'dams', featureId: 'a1', feature: { fake: 'feature' }, isoProps: {} };
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    const onChange = vi.fn();
    act(() => result.current.startModify(onChange));
    expect(modStart).toHaveBeenCalledWith({ fake: 'feature' }, onChange);
  });

  it('does nothing when nothing is selected', () => {
    currentSelection = null;
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    act(() => result.current.startModify(vi.fn()));
    expect(modStart).not.toHaveBeenCalled();
  });

  it('cancelModify delegates to the ModifyController', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    act(() => result.current.cancelModify());
    expect(modCancel).toHaveBeenCalled();
  });
});
