import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A fake ol/Map exposing layers whose get('id') matches a layerStateId,
// each with a source of stub features carrying a real getId().
function fakeFeature(id: string, props: Record<string, unknown>, coords: number[] | null = [108, 14]) {
  return {
    getId: () => id,
    getProperties: () => props,
    // Real ol geometries expose getExtent(); a point's extent is [x,y,x,y].
    getGeometry: () =>
      coords
        ? {
            getType: () => 'Point',
            getCoordinates: () => coords,
            getExtent: () => [coords[0], coords[1], coords[0], coords[1]],
          }
        : null,
    get: (k: string) => props[k],
  };
}
let fitSpy = vi.fn();
function fakeMap(featuresByLayerId: Record<string, unknown[] | null>) {
  const handlers: Record<string, (() => void)[]> = {};
  const layers = Object.entries(featuresByLayerId).map(([id, feats]) => ({
    get: (k: string) => (k === 'id' ? id : undefined),
    getSource: () =>
      feats === null
        ? null
        : {
            getFeatures: () => featuresByLayerId[id],
            on: (t: string, h: () => void) => { (handlers[id + t] ||= []).push(h); },
            un: (_t: string, _h: () => void) => {},
          },
  }));
  const fire = (id: string, t = 'change') => (handlers[id + t] || []).forEach((h) => h());
  return {
    getLayers: () => ({ getArray: () => layers }),
    getView: () => ({ fit: fitSpy }),
    __fire: fire,           // test hook to simulate a source load event
    __data: featuresByLayerId,
  };
}

let mockMap: unknown = null;
vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ map: mockMap, toggleLayerVisibility: vi.fn() }),
}));

const selectByIdSpy = vi.fn();
vi.mock('../../../entities/selection', () => ({
  useSelection: () => ({ selection: null, selectById: selectByIdSpy, clear: vi.fn() }),
}));

import { useFilterPresenter } from './useFilterPresenter';

beforeEach(() => { mockMap = null; fitSpy = vi.fn(); selectByIdSpy.mockClear(); });

describe('useFilterPresenter', () => {
  it('starts closed with no layer and no results', () => {
    const { result } = renderHook(() => useFilterPresenter());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.layerKey).toBeNull();
    expect(result.current.results).toEqual([]);
    expect(result.current.activeCount).toBe(0);
  });

  it('picking a layer populates its filter fields', () => {
    mockMap = fakeMap({ layer_dams: [] });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.open());
    act(() => result.current.setLayer('dams'));
    expect(result.current.fields.some((f) => f.iso === 'statusSlug')).toBe(true);
  });

  it('reports the active layer as unloaded when its source has not loaded', () => {
    mockMap = fakeMap({}); // dams layer absent -> no source at all
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    expect(result.current.unloadedLayers).toContain('dams');
  });

  it('does NOT report the active layer as unloaded once its source has loaded, even with zero features', () => {
    mockMap = fakeMap({ layer_dams: [] }); // source exists, genuinely empty
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    expect(result.current.unloadedLayers).not.toContain('dams');
  });

  it('re-derives results when the source finishes loading after enable (loadTick)', () => {
    // Starts loaded-but-empty (source exists), like a layer just switched on and
    // still awaiting its WFS response.
    const data: Record<string, unknown[] | null> = { layer_stations: [] };
    mockMap = fakeMap(data);
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('stations'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'geographicalName', op: 'contains', value: 'a' }));
    expect(result.current.count).toBe(0);
    // Simulate the WFS load arriving: features appear, then the source emits 'change'.
    act(() => {
      data.layer_stations = [fakeFeature('s1', { geographicalName: 'Trạm A' })];
      (mockMap as { __fire: (id: string) => void }).__fire('layer_stations');
    });
    expect(result.current.count).toBe(1);
  });

  it('derives results from live features once conditions are added, keyed by real feature id', () => {
    mockMap = fakeMap({
      layer_dams: [
        fakeFeature('d1', { geographicalName: 'Đập A', statusSlug: 'xa_lu', ratedPower: 250 }),
        fakeFeature('d2', { geographicalName: 'Đập B', statusSlug: 'binh_thuong', ratedPower: 100 }),
      ],
    });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    expect(result.current.count).toBe(1);
    expect(result.current.results[0].label).toBe('Đập A');
    expect(result.current.results[0].id).toBe('d1');
    expect(result.current.activeCount).toBe(1);
  });

  it('reports the empty-filter error when no conditions are set, instead of an empty list', () => {
    mockMap = fakeMap({ layer_dams: [fakeFeature('d1', { statusSlug: 'xa_lu' })] });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    expect(result.current.error).toBe('Chưa có điều kiện lọc');
    expect(result.current.results).toEqual([]);
  });

  it('clear removes all conditions and returns to the empty-filter state', () => {
    mockMap = fakeMap({ layer_dams: [fakeFeature('d1', { statusSlug: 'xa_lu' })] });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    act(() => result.current.clear());
    expect(result.current.activeCount).toBe(0);
    expect(result.current.error).toBe('Chưa có điều kiện lọc');
  });

  it('clicking a result SELECTS the feature (by real id) and frames it via view.fit', () => {
    mockMap = fakeMap({
      layer_dams: [fakeFeature('d1', { geographicalName: 'Đập A', statusSlug: 'xa_lu' }, [108, 14])],
    });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    act(() => result.current.onResultClick(result.current.results[0].id));
    expect(selectByIdSpy).toHaveBeenCalledWith('dams', 'd1');
    expect(fitSpy).toHaveBeenCalled();
  });

  it('onResultClick on a LINE feature fits the extent, not a nested coord array (whiteout regression)', () => {
    // A river geometry: getCoordinates() is nested [[x,y],...]; getExtent() is [minX,minY,maxX,maxY].
    const riverFeature = {
      getId: () => 'r1',
      getProperties: () => ({ geographicalName: 'Sông Ba', streamOrder: 3 }),
      getGeometry: () => ({
        getType: () => 'MultiLineString',
        getCoordinates: () => [[[100, 200], [300, 400]]], // nested — the old code passed THIS as center
        getExtent: () => [100, 200, 300, 400],
      }),
      get: (k: string) => ({ streamOrder: 3 } as Record<string, unknown>)[k],
    };
    mockMap = fakeMap({ layer_rivers: [riverFeature] });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('rivers'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'streamOrder', op: 'eq', value: '3' }));
    act(() => result.current.onResultClick(result.current.results[0].id));
    const arg = fitSpy.mock.calls[0][0];
    expect(arg).toEqual([100, 200, 300, 400]); // the extent, not the nested coordinate array
  });

  it('new text conditions default to "contains"; picking an enum field defaults to "eq"', () => {
    mockMap = fakeMap({ layer_dams: [] });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    // addCondition seeds the first field (geographicalName, a text field) — expect 'contains'.
    expect(result.current.conditions[0].op).toBe('contains');
    act(() => result.current.updateCondition(0, { field: 'statusSlug' }));
    expect(result.current.conditions[0].op).toBe('eq');
    act(() => result.current.updateCondition(0, { field: 'geographicalName' }));
    expect(result.current.conditions[0].op).toBe('contains');
  });
});
