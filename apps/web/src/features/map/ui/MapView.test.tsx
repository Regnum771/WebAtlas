import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

const setBusy = vi.fn();
vi.mock('../../dictionary', async () => {
  const shared = await import('@webatlas/shared');
  return { useDictionary: () => shared.DICTIONARY };
});
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
const setReadoutTargets = vi.fn();
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
    setReadoutTargets,
  })),
}));

import MapView from './MapView';
import { resetReadoutTargets, setCoordinatesTarget, setScaleLineTarget } from '../model/readoutTargets';

describe('MapView', () => {
  beforeEach(() => {
    updateSize.mockClear();
    init.mockClear();
    setLoadingListener.mockClear();
    setBusy.mockClear();
    setReadoutTargets.mockClear();
    resetReadoutTargets();
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

  it('hands the readout elements of the status bar to the map, whichever mounts first', () => {
    const coords = document.createElement('div');
    const scale = document.createElement('div');
    render(<MapView />);
    expect(setReadoutTargets).toHaveBeenLastCalledWith({ coordinates: null, scaleLine: null });
    act(() => { setCoordinatesTarget(coords); setScaleLineTarget(scale); });
    expect(setReadoutTargets).toHaveBeenLastCalledWith({ coordinates: coords, scaleLine: scale });
    act(() => { setCoordinatesTarget(null); });
    expect(setReadoutTargets).toHaveBeenLastCalledWith({ coordinates: null, scaleLine: scale });
  });
});
