import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

const setBusy = vi.fn();
vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({
    setMap: vi.fn(),
    setBusy,
    basemap: 'street',
    layersState: [],
    reservoirFilter: 'all',
    contourSettings: { interval: 'auto', labels: true },
  }),
}));

vi.mock('../model/mapEditing', () => ({
  useMapEditing: () => ({ registerRefresh: vi.fn(), registerSetSelectActive: vi.fn() }),
}));

const updateSize = vi.fn();
const init = vi.fn();
const setLoadingListener = vi.fn();
vi.mock('../model/MapModel', () => ({
  MapModel: vi.fn().mockImplementation(() => ({
    init,
    getMap: () => null,
    updateSize,
    setLoadingListener,
    dispose: vi.fn(),
    applyLayerStates: vi.fn(),
    setBasemap: vi.fn(),
    setReservoirFilter: vi.fn(),
    setContourSettings: vi.fn(),
    setCoordinateFormat: vi.fn(),
  })),
}));

import MapView from './MapView';

describe('MapView', () => {
  beforeEach(() => {
    updateSize.mockClear();
    init.mockClear();
    setLoadingListener.mockClear();
    setBusy.mockClear();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('tells OpenLayers when its own box changes size', () => {
    let fire: () => void = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation((cb: () => void) => {
      fire = cb;
      return { observe, disconnect, unobserve: vi.fn() };
    }));
    const { container, unmount } = render(<MapView />);
    expect(observe).toHaveBeenCalledWith(container.querySelector('.map-container'));
    updateSize.mockClear();
    act(() => { fire(); });
    expect(updateSize).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('mounts where ResizeObserver does not exist', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { unmount } = render(<MapView />);
    updateSize.mockClear();
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(updateSize).toHaveBeenCalledTimes(1);
    unmount();
    updateSize.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(updateSize).not.toHaveBeenCalled();
  });

  it('registers setBusy (from MapProvider) as the model load-tracking listener on mount', () => {
    render(<MapView />);
    // Without this assertion, deleting model.setLoadingListener(setBusy) in
    // MapView.tsx would break no test and the loading bar would stay silent
    // for good (see review round 1 finding).
    expect(setLoadingListener).toHaveBeenCalledTimes(1);
    expect(setLoadingListener).toHaveBeenCalledWith(setBusy);
  });
});
