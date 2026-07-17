import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const startDraw = vi.fn();
const cancelDraw = vi.fn();
vi.mock('../../map/model/mapEditing', () => ({
  useMapEditing: () => ({ hasMap: true, startDraw, cancelDraw, refreshLayer: vi.fn(), registerRefresh: vi.fn() }),
}));
vi.mock('../../../entities/layer/useLayerCatalog', () => ({
  useLayerCatalog: () => ({
    data: [
      { key: 'dams', geomType: 'Point', attributes: ['name', 'status'] },
      { key: 'rivers', geomType: 'MultiLineString', attributes: ['name', 'code'] },
    ],
    isLoading: false,
  }),
}));
import { useEditToolbarPresenter } from './useEditToolbarPresenter';

describe('useEditToolbarPresenter', () => {
  beforeEach(() => { startDraw.mockReset(); cancelDraw.mockReset(); });

  it('lists layers and starts idle with nothing selected', () => {
    const { result } = renderHook(() => useEditToolbarPresenter());
    expect(result.current.layers.map((l) => l.key)).toEqual(['dams', 'rivers']);
    expect(result.current.mode).toBe('idle');
    expect(result.current.selectedKey).toBeNull();
  });

  it('selecting a layer then drawing calls startDraw with that geomType', () => {
    const { result } = renderHook(() => useEditToolbarPresenter());
    act(() => result.current.selectLayer('rivers'));
    expect(result.current.selectedKey).toBe('rivers');
    act(() => result.current.startDrawing());
    expect(result.current.mode).toBe('drawing');
    expect(startDraw).toHaveBeenCalledWith('MultiLineString', expect.any(Function));
  });

  it('onGeometryFinished sets pendingGeometry and switches to form mode', () => {
    const { result } = renderHook(() => useEditToolbarPresenter());
    act(() => result.current.selectLayer('dams'));
    act(() => result.current.startDrawing());
    const onFinish = startDraw.mock.calls[0][1];
    const geom = { type: 'Point', coordinates: [108, 13] };
    act(() => onFinish(geom));
    expect(result.current.pendingGeometry).toEqual(geom);
    expect(result.current.mode).toBe('form');
  });

  it('cancel resets to idle and clears geometry', () => {
    const { result } = renderHook(() => useEditToolbarPresenter());
    act(() => result.current.selectLayer('dams'));
    act(() => result.current.startDrawing());
    act(() => result.current.cancel());
    expect(cancelDraw).toHaveBeenCalled();
    expect(result.current.mode).toBe('idle');
    expect(result.current.pendingGeometry).toBeNull();
  });
});
