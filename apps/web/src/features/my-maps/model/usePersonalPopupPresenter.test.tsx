import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown) => void>(),
  hit: null as null | { mapId: string; layerId: string; feature: unknown },
  drawing: false,
  justEnded: false,
  editing: false,
}));

vi.mock('../../../app/providers/MapProvider', () => {
  const target = document.createElement('div');
  target.getBoundingClientRect = () => ({ left: 300, top: 50, right: 1300, bottom: 850, width: 1000, height: 800, x: 300, y: 50, toJSON: () => ({}) });
  const map = {
    on: (ev: string, fn: (e: unknown) => void) => { h.handlers.set(ev, fn); },
    un: (ev: string) => { h.handlers.delete(ev); },
    getPixelFromCoordinate: () => [40, 60],
    getTargetElement: () => target,
  };
  return { useMapContext: () => ({ map }) };
});
vi.mock('../../map/model/drawingState', () => ({ isDrawing: () => h.drawing, drawingJustEnded: () => h.justEnded }));
vi.mock('../../map/model/mapEditing', () => ({ useMapEditing: () => ({ editing: h.editing }) }));
vi.mock('./personalLayers', () => ({ personalFeatureAt: () => h.hit }));
const setRoi = vi.hoisted(() => vi.fn());
vi.mock('../../roi/model/roi.store', () => ({ setRoi }));

import { usePersonalPopupPresenter } from './usePersonalPopupPresenter';
import { keys } from './queries';
import { expandMap, forgetMap, resetMyMapsStore, setPersonalEditing, toggleExpanded } from './myMaps.store';

const DETAIL = {
  id: 'm1', title: 'Lũ Đà Nẵng', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 3,
  updatedAt: '2026-10-01T00:00:00Z', layerCount: 1, role: 'owner' as const,
  layers: [{ id: 'l1', kind: 'free', title: 'Cống thoát nước', position: 0, style: {}, geometryType: 'point', fields: [], layerKey: null, draftId: null, featureCount: 1, raster: null }],
};
const FEATURE = {
  type: 'Feature', id: 'f1', geometry: { type: 'Point', coordinates: [108.2, 16.05] },
  properties: { ten: 'Cống A', so_cua: 3, ghi_chu: null },
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(keys.map('m1'), DETAIL);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => usePersonalPopupPresenter(), { wrapper });
}
const click = () => act(() => { h.handlers.get('singleclick')!({ pixel: [40, 60], coordinate: [1, 2] }); });

beforeEach(() => {
  h.hit = { mapId: 'm1', layerId: 'l1', feature: FEATURE };
  h.drawing = false; h.justEnded = false; h.editing = false;
  resetMyMapsStore();
  // A personal feature is on the map only while its map's card is open.
  expandMap('m1');
  setRoi.mockReset();
});

describe('usePersonalPopupPresenter', () => {
  it('shows the layer title and the properties, with null as —', () => {
    const { result } = setup();
    expect(result.current.card).toBeNull();
    click();
    expect(result.current.card).toMatchObject({
      title: 'Cống thoát nước',
      rows: [{ key: 'ten', value: 'Cống A' }, { key: 'so_cua', value: '3' }, { key: 'ghi_chu', value: '—' }],
    });
    // Placed at the click, shifted by where the map starts in the window.
    expect(result.current.anchor).toEqual([340, 110]);
    act(() => result.current.close());
    expect(result.current.card).toBeNull();
  });

  it('opens nothing while a drawing or an edit mode holds the map, official or personal', () => {
    const { result, rerender } = setup();
    for (const flag of ['drawing', 'justEnded', 'editing'] as const) {
      h[flag] = true;
      rerender();
      click();
      expect(result.current.card).toBeNull();
      h[flag] = false;
      rerender();
    }
    act(() => setPersonalEditing(true));
    click();
    expect(result.current.card).toBeNull();
    act(() => setPersonalEditing(false));
    click();
    expect(result.current.card).not.toBeNull();
  });

  it('a click off any personal feature closes the card', () => {
    const { result } = setup();
    click();
    expect(result.current.card).not.toBeNull();
    h.hit = null;
    click();
    expect(result.current.card).toBeNull();
  });

  it('the card closes when its map is folded or dropped, and stays closed when it opens again', () => {
    const { result } = setup();
    click();
    expect(result.current.card).not.toBeNull();
    act(() => toggleExpanded('m1'));
    expect(result.current.card).toBeNull();
    expect(result.current.anchor).toBeNull();
    act(() => toggleExpanded('m1'));
    expect(result.current.card).toBeNull();
    click();
    expect(result.current.card).not.toBeNull();
    act(() => forgetMap('m1', ['l1']));
    expect(result.current.card).toBeNull();
  });

  it('a polygon feature becomes the drawn ROI', () => {
    const polygon = { type: 'Polygon', coordinates: [[[108, 16], [108.1, 16], [108.1, 16.1], [108, 16]]] };
    h.hit = { mapId: 'm1', layerId: 'l1', feature: { ...FEATURE, geometry: polygon } };
    const { result } = setup();
    click();
    expect(result.current.canUseAsRoi).toBe(true);
    act(() => result.current.useAsRoi());
    expect(setRoi).toHaveBeenCalledWith({ source: 'drawn', geometry: polygon }, { fit: 'ifOutside' });
    expect(result.current.card).toBeNull();
  });

  it('a MultiPolygon feature cannot be the ROI', () => {
    h.hit = { mapId: 'm1', layerId: 'l1', feature: { ...FEATURE, geometry: { type: 'MultiPolygon', coordinates: [] } } };
    const { result } = setup();
    click();
    expect(result.current.canUseAsRoi).toBe(false);
    act(() => result.current.useAsRoi());
    expect(setRoi).not.toHaveBeenCalled();
  });
});
