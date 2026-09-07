import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { buildPanelGroups, useLayersPanel } from './useLayersPanel';

const display = {
  layer_dams: { name: 'Đập & Hồ chứa', group: 'Tài nguyên nước' },
  layer_rivers: { name: 'Mạng lưới sông ngòi', group: 'Tài nguyên nước', minZoom: 8.5 },
  layer_provinces_2026: { name: 'Ranh giới Tỉnh', group: 'Ranh giới hành chính' },
};

const state = [
  { id: 'layer_dams', visible: true, opacity: 1 },
  { id: 'layer_rivers', visible: true, opacity: 0.8 },
  { id: 'layer_provinces_2026', visible: true, opacity: 1 },
];

describe('buildPanelGroups', () => {
  it('groups layers by their display group, preserving first-seen order', () => {
    const groups = buildPanelGroups({ display, layersState: state, currentZoom: 10 });
    expect(groups.map((g) => g.name)).toEqual(['Tài nguyên nước', 'Ranh giới hành chính']);
    expect(groups[0].layers.map((l) => l.id)).toEqual(['layer_dams', 'layer_rivers']);
  });

  it('marks a layer gated when the current zoom is below its minZoom', () => {
    const groups = buildPanelGroups({ display, layersState: state, currentZoom: 7 });
    const rivers = groups[0].layers.find((l) => l.id === 'layer_rivers')!;
    expect(rivers.gated).toBe(true);
    expect(rivers.gateHint).toBe('hiện từ mức 8,5');
  });

  it('does not mark a layer gated at or above its minZoom', () => {
    const groups = buildPanelGroups({ display, layersState: state, currentZoom: 8.5 });
    const rivers = groups[0].layers.find((l) => l.id === 'layer_rivers')!;
    expect(rivers.gated).toBe(false);
    expect(rivers.gateHint).toBeUndefined();
  });

  it('skips state entries that have no display metadata rather than crashing', () => {
    const groups = buildPanelGroups({
      display,
      layersState: [...state, { id: 'layer_unknown', visible: true, opacity: 1 }],
      currentZoom: 10,
    });
    expect(groups.flatMap((g) => g.layers).map((l) => l.id)).not.toContain('layer_unknown');
  });
});

// --- useLayersPanel (the hook): must dispatch through createCommandExecutor,
// not call the MapProvider context setters directly (see mapCommands.ts —
// setLayerVisible/setLayerOpacity had zero UI producers before this change).

const panelLayersState = [
  { id: 'layer_dams', visible: true, opacity: 1 },
  { id: 'layer_rivers', visible: false, opacity: 0.5 },
];
const contextToggleLayerVisibility = vi.fn();
const contextSetLayerOpacity = vi.fn();
vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({
    map: null,
    setBasemap: vi.fn(),
    layersState: panelLayersState,
    toggleLayerVisibility: contextToggleLayerVisibility,
    setLayerOpacity: contextSetLayerOpacity,
  }),
}));

vi.mock('../../../entities/layer/useLayerCatalog', () => ({
  useLayerCatalog: () => ({ data: [], isError: false }),
}));

const run = vi.fn(() => ({ ok: true as const, text: '' }));
vi.mock('../../map/model/mapCommands', () => ({
  createCommandExecutor: vi.fn(() => run),
}));

describe('useLayersPanel dispatch', () => {
  beforeEach(() => {
    run.mockClear();
    contextToggleLayerVisibility.mockClear();
    contextSetLayerOpacity.mockClear();
  });

  it('toggling a visible layer issues setLayerVisible with the new (opposite) value, not the current one', () => {
    const { result } = renderHook(() => useLayersPanel(10));
    act(() => result.current.toggleLayerVisibility('layer_dams'));
    expect(run).toHaveBeenCalledWith({ kind: 'setLayerVisible', layerStateId: 'layer_dams', visible: false });
  });

  it('toggling a hidden layer issues setLayerVisible with visible:true', () => {
    const { result } = renderHook(() => useLayersPanel(10));
    act(() => result.current.toggleLayerVisibility('layer_rivers'));
    expect(run).toHaveBeenCalledWith({ kind: 'setLayerVisible', layerStateId: 'layer_rivers', visible: true });
  });

  it('does not call the context toggle setter directly — only the executor does', () => {
    const { result } = renderHook(() => useLayersPanel(10));
    act(() => result.current.toggleLayerVisibility('layer_dams'));
    expect(contextToggleLayerVisibility).not.toHaveBeenCalled();
  });

  it('changing opacity issues setLayerOpacity through the executor', () => {
    const { result } = renderHook(() => useLayersPanel(10));
    act(() => result.current.setLayerOpacity('layer_dams', 0.4));
    expect(run).toHaveBeenCalledWith({ kind: 'setLayerOpacity', layerStateId: 'layer_dams', opacity: 0.4 });
  });

  it('does not call the context opacity setter directly — only the executor does', () => {
    const { result } = renderHook(() => useLayersPanel(10));
    act(() => result.current.setLayerOpacity('layer_dams', 0.4));
    expect(contextSetLayerOpacity).not.toHaveBeenCalled();
  });
});
