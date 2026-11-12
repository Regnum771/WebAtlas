import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { buildPanelGroups, filterPanelGroups, foldForSearch, useLayersPanel, type PanelGroup } from './useLayersPanel';

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
    // Dùng layer_lakes chứ không phải layer_rivers: sông đã có lớp tổng quan vẽ
    // thay ở mức thu nhỏ nên cố tình được miễn cổng — xem 'the rivers gate hint'
    // ở cuối tệp. Hồ thì vẫn biến mất thật, nên nó mới là ví dụ đúng cho luật này.
    const lakes = { name: 'Hồ & Hồ chứa', group: 'Tài nguyên nước', minZoom: 8.5 };
    const groups = buildPanelGroups({
      display: { ...display, layer_lakes: lakes },
      layersState: [{ id: 'layer_lakes', visible: true, opacity: 0.85 }],
      currentZoom: 7,
    });
    const found = groups[0].layers.find((l) => l.id === 'layer_lakes')!;
    expect(found.gated).toBe(true);
    // The note names the scale, as the status bar reads it, not a zoom level.
    expect(found.scaleNote).toBe('từ 1:1.570.000');
  });

  it('does not mark a layer gated at or above its minZoom', () => {
    const groups = buildPanelGroups({ display, layersState: state, currentZoom: 8.5 });
    const rivers = groups[0].layers.find((l) => l.id === 'layer_rivers')!;
    expect(rivers.gated).toBe(false);
    expect(rivers.scaleNote).toBeUndefined();
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

describe('buildPanelGroups counts, notes and swatches', () => {
  it('counts the layers on and in total per group', () => {
    const groups = buildPanelGroups({
      display,
      layersState: [
        { id: 'layer_dams', visible: true, opacity: 1 },
        { id: 'layer_rivers', visible: false, opacity: 0.8 },
        { id: 'layer_provinces_2026', visible: false, opacity: 1 },
      ],
      currentZoom: 9,
    });
    expect(groups.map((g) => [g.name, g.on, g.total])).toEqual([
      ['Tài nguyên nước', 1, 2],
      ['Ranh giới hành chính', 0, 1],
    ]);
  });

  it('keeps the scale note on a limited layer at every zoom, gated or not', () => {
    const wards = { name: 'Ranh giới Xã/Phường', group: 'Ranh giới hành chính', minZoom: 10 };
    const at = (currentZoom: number) => buildPanelGroups({
      display: { layer_wards: wards }, layersState: [{ id: 'layer_wards', visible: true, opacity: 1 }], currentZoom,
    })[0].layers[0];
    expect(at(8)).toMatchObject({ gated: true, scaleNote: 'từ 1:555.000' });
    expect(at(11)).toMatchObject({ gated: false, scaleNote: 'từ 1:555.000' });
  });

  it('gives each row the swatch it is asked for', () => {
    const swatch = { label: 'Đập', swatch: '#123456', shape: 'dot' as const };
    const groups = buildPanelGroups({
      display, layersState: state, currentZoom: 9, swatchFor: (id) => (id === 'layer_dams' ? swatch : null),
    });
    expect(groups[0].layers.map((l) => l.swatch)).toEqual([swatch, null]);
  });
});

describe('filterPanelGroups', () => {
  const groups: PanelGroup[] = [
    { name: 'Tài nguyên nước', on: 1, total: 2, layers: [
      { id: 'layer_dams', name: 'Đập & Hồ chứa', visible: true, opacity: 1, gated: false },
      { id: 'layer_rivers', name: 'Mạng lưới sông ngòi', visible: false, opacity: 1, gated: false },
    ] },
    { name: 'Hiểm hoạ', on: 0, total: 1, layers: [
      { id: 'layer_flood', name: 'Vùng ngập lụt', visible: false, opacity: 1, gated: false },
    ] },
  ];

  it('matches names without regard to accents, đ or case', () => {
    expect(foldForSearch('  Đập & Hồ  ')).toBe('dap & ho');
    expect(filterPanelGroups(groups, 'DAP').flatMap((g) => g.layers.map((l) => l.id))).toEqual(['layer_dams']);
    expect(filterPanelGroups(groups, 'song ngoi').flatMap((g) => g.layers.map((l) => l.id))).toEqual(['layer_rivers']);
  });

  it('drops groups left empty, keeps their counts, and returns everything for a blank query', () => {
    const narrowed = filterPanelGroups(groups, 'ngập');
    expect(narrowed.map((g) => [g.name, g.on, g.total])).toEqual([['Hiểm hoạ', 0, 1]]);
    expect(filterPanelGroups(groups, '   ')).toBe(groups);
    expect(filterPanelGroups(groups, 'không có')).toEqual([]);
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

vi.mock('../../dictionary', async () => {
  const shared = await import('@webatlas/shared');
  return { useDictionary: () => shared.DICTIONARY };
});

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

describe('the rivers gate hint', () => {
  it('does not claim rivers are hidden when the overview layer is drawing them', () => {
    // layer_rivers keeps minZoom 8,5 because the FULL network is still gated —
    // but since the overview layer was added, the main trunks are on screen at
    // every zoom. Telling the user "hiện từ mức 8,5" would contradict what they
    // can plainly see.
    const groups = buildPanelGroups({
      display,
      layersState: [{ id: 'layer_rivers', visible: true, opacity: 0.8 }],
      currentZoom: 6,
    });
    const rivers = groups.flatMap((g) => g.layers).find((l) => l.id === 'layer_rivers');
    expect(rivers?.gated).toBe(false);
    expect(rivers?.scaleNote).toBeUndefined();
  });

  it('still gates the layers that really do disappear', () => {
    const groups = buildPanelGroups({
      display: { ...display, layer_lakes: { name: 'Hồ & Hồ chứa', group: 'Tài nguyên nước', minZoom: 8.5 } },
      layersState: [{ id: 'layer_lakes', visible: true, opacity: 0.85 }],
      currentZoom: 6,
    });
    const lakes = groups.flatMap((g) => g.layers).find((l) => l.id === 'layer_lakes');
    expect(lakes?.gated).toBe(true);
  });
});

describe('useLayersPanel Tắt hết', () => {
  beforeEach(() => { run.mockClear(); });

  it('counts the layers on and turns each of them off through the executor', () => {
    const { result } = renderHook(() => useLayersPanel(12));
    expect(result.current.onCount).toBe(1);
    act(() => { result.current.turnAllOff(); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ kind: 'setLayerVisible', layerStateId: 'layer_dams', visible: false });
    expect(contextToggleLayerVisibility).not.toHaveBeenCalled();
  });
});
