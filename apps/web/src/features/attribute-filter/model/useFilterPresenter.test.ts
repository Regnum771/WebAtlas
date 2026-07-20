import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A fake ol/Map exposing layers whose get('id') matches a layerStateId,
// each with a source of stub features.
function fakeFeature(props: Record<string, unknown>, coords: number[] | null = [108, 14]) {
  return {
    getProperties: () => props,
    getGeometry: () => (coords ? { getType: () => 'Point', getCoordinates: () => coords } : null),
    get: (k: string) => props[k],
  };
}
let animateSpy = vi.fn();
function fakeMap(featuresByLayerId: Record<string, unknown[]>) {
  const layers = Object.entries(featuresByLayerId).map(([id, features]) => ({
    get: (k: string) => (k === 'id' ? id : undefined),
    getSource: () => ({ getFeatures: () => features }),
  }));
  return {
    getLayers: () => ({ getArray: () => layers }),
    getView: () => ({ animate: animateSpy }),
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
});
