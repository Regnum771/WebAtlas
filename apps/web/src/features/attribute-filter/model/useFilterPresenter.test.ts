import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A fake ol/Map exposing layers whose get('id') matches a layerStateId,
// each with a source of stub features.
function fakeFeature(props: Record<string, unknown>, coords: number[] | null = [108, 14]) {
  return {
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
let animateSpy = vi.fn();
function fakeMap(featuresByLayerId: Record<string, unknown[]>) {
  const handlers: Record<string, (() => void)[]> = {};
  const layers = Object.entries(featuresByLayerId).map(([id]) => ({
    get: (k: string) => (k === 'id' ? id : undefined),
    getSource: () => ({
      getFeatures: () => featuresByLayerId[id],
      on: (t: string, h: () => void) => { (handlers[id + t] ||= []).push(h); },
      un: (_t: string, _h: () => void) => {},
    }),
  }));
  const fire = (id: string, t = 'change') => (handlers[id + t] || []).forEach((h) => h());
  return {
    getLayers: () => ({ getArray: () => layers }),
    getView: () => ({ animate: animateSpy }),
    __fire: fire,           // test hook to simulate a source load event
    __data: featuresByLayerId,
  };
}

let mockMap: unknown = null;
vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ map: mockMap, toggleLayerVisibility: vi.fn() }),
}));

import { useFilterPresenter } from './useFilterPresenter';

beforeEach(() => { mockMap = null; animateSpy = vi.fn(); });

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

  it('reports layerLoaded=false when the layer has no loaded features', () => {
    mockMap = fakeMap({}); // dams layer absent
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    expect(result.current.layerLoaded).toBe(false);
  });

  it('re-derives layerLoaded when the source finishes loading after enable', () => {
    const data: Record<string, unknown[]> = { layer_stations: [] }; // starts loaded-but-empty
    mockMap = fakeMap(data);
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('stations'));
    expect(result.current.layerLoaded).toBe(false);
    // Simulate the WFS load arriving: features appear, then the source emits 'change'.
    act(() => {
      data.layer_stations = [fakeFeature({ geographicalName: 'Trạm A' })];
      (mockMap as { __fire: (id: string) => void }).__fire('layer_stations');
    });
    expect(result.current.layerLoaded).toBe(true);
  });

  it('derives results from live features once conditions are added', () => {
    mockMap = fakeMap({
      layer_dams: [
        fakeFeature({ geographicalName: 'Đập A', statusSlug: 'xa_lu', ratedPower: 250 }),
        fakeFeature({ geographicalName: 'Đập B', statusSlug: 'binh_thuong', ratedPower: 100 }),
      ],
    });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    expect(result.current.count).toBe(1);
    expect(result.current.results[0].label).toBe('Đập A');
    expect(result.current.activeCount).toBe(1);
  });

  it('clear removes all conditions and results', () => {
    mockMap = fakeMap({ layer_dams: [fakeFeature({ statusSlug: 'xa_lu' })] });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    act(() => result.current.clear());
    expect(result.current.results).toEqual([]);
    expect(result.current.activeCount).toBe(0);
  });

  it('flyTo animates the view to a matched feature with geometry', () => {
    mockMap = fakeMap({ layer_dams: [fakeFeature({ geographicalName: 'Đập A', statusSlug: 'xa_lu' }, [108, 14])] });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    act(() => result.current.flyTo(result.current.results[0].id));
    expect(animateSpy).toHaveBeenCalled();
  });

  it('flyTo on a LINE feature centres on the extent, not a nested coord array (whiteout regression)', () => {
    // A river geometry: getCoordinates() is nested [[x,y],...]; getExtent() is [minX,minY,maxX,maxY].
    const riverFeature = {
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
    act(() => result.current.flyTo(result.current.results[0].id));
    // The center must be the extent midpoint [200,300], NOT the nested coordinate array.
    const arg = animateSpy.mock.calls[0][0];
    expect(arg.center).toEqual([200, 300]);
    expect(Array.isArray(arg.center[0])).toBe(false); // not nested -> no whiteout
  });
});
