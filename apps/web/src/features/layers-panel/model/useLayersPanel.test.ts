import { describe, it, expect } from 'vitest';
import { buildPanelGroups } from './useLayersPanel';

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
