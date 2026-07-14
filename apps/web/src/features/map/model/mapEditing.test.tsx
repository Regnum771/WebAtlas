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
