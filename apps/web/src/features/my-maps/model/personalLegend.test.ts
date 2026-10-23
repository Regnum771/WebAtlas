import { describe, it, expect, beforeEach } from 'vitest';
import type { MapDetail, LayerSummary } from '../api/workspace.api';
import { personalLegendItems } from './personalLegend';
import { resetMyMapsStore, setLayerVisible } from './myMaps.store';

const layer = (over: Partial<LayerSummary>): LayerSummary => ({
  id: 'l', kind: 'free', title: 'T', position: 0, style: {}, geometryType: 'point', fields: [],
  layerKey: null, draftId: null, featureCount: 0, raster: null, ...over,
});
const detail = (layers: LayerSummary[]): MapDetail => ({
  id: 'm', title: 'M', description: '', ownerId: 'u', ownerName: 'Tôi', revision: 1,
  updatedAt: '2026-10-01T00:00:00Z', layerCount: layers.length, role: 'owner', layers,
});

beforeEach(() => resetMyMapsStore());

describe('personalLegendItems', () => {
  it('lists visible layers with their style colour; hidden ones are left out', () => {
    setLayerVisible('hidden', false);
    const items = personalLegendItems([detail([
      layer({ id: 'a', title: 'Cống', style: { color: '#112233' } }),
      layer({ id: 'hidden', title: 'Ẩn' }),
    ])]);
    expect(items).toEqual([{ id: 'a', title: 'Cống', color: '#112233', raster: false }]);
  });

  it('an edit copy takes the official layer colour, a raster is flagged, a bad style falls back', () => {
    const items = personalLegendItems([detail([
      layer({ id: 'e', kind: 'edit_copy', layerKey: 'rivers', title: 'Sông' }),
      layer({ id: 'r', kind: 'raster', title: 'Ảnh' }),
      layer({ id: 'f', title: 'Lỗi', style: { color: 'red' } }),
    ])]);
    expect(items.map((i) => [i.id, i.raster])).toEqual([['e', false], ['r', true], ['f', false]]);
    expect(items[0].color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(items[2].color).toBe('#d9480f');
  });
});
