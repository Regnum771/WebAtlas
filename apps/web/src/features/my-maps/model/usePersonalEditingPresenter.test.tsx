import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown) => void>(),
  hit: null as null | { mapId: string; layerId: string; feature: { id: string; geometry: unknown; properties: Record<string, unknown> } },
}));

const getMap = vi.fn();
const listMaps = vi.fn();
const addFeature = vi.fn();
const updateFeature = vi.fn();
const removeFeature = vi.fn();
vi.mock('../api/workspace.api', () => ({
  getMap: (id: string) => getMap(id),
  listMaps: () => listMaps(),
  addFeature: (...a: unknown[]) => addFeature(...a),
  updateFeature: (...a: unknown[]) => updateFeature(...a),
  removeFeature: (...a: unknown[]) => removeFeature(...a),
}));
const refreshPersonalLayer = vi.fn();
const personalFeatureAt = vi.fn((..._a: unknown[]) => h.hit);
vi.mock('./personalLayers', () => ({
  refreshPersonalLayer: (...a: unknown[]) => refreshPersonalLayer(...a),
  personalFeatureAt: (...a: unknown[]) => personalFeatureAt(...a),
}));
const MAP = {
  on: (ev: string, fn: (e: unknown) => void) => { h.handlers.set(ev, fn); },
  un: (ev: string) => { h.handlers.delete(ev); },
};
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => ({ map: MAP }) }));
const startDraw = vi.fn();
const cancelDraw = vi.fn();
const startModifyFeature = vi.fn();
const cancelModify = vi.fn();
vi.mock('../../map/model/mapEditing', () => ({
  useMapEditing: () => ({ hasMap: true, startDraw, cancelDraw, startModifyFeature, cancelModify }),
}));
// The official feature routes: an edit copy must never reach them.
const officialCreate = vi.fn();
const officialUpdate = vi.fn();
vi.mock('../../feature-editing/api/features.api', () => ({
  createFeature: (...a: unknown[]) => officialCreate(...a),
  updateFeature: (...a: unknown[]) => officialUpdate(...a),
}));
vi.mock('../../feature-editing/model/useManagingUnitField', () => ({
  useManagingUnitField: () => ({
    value: '48', setValue: vi.fn(), options: [], allowed: () => true, tree: null, suggestion: null, error: null,
    hint: null, readOnlyText: null, locked: false, submittable: '48',
  }),
}));

import { ApiError } from '../../../shared/api/apiClient';
import { getShell, openTool, resetShell } from '../../shell/model/shell.store';
import { useAttributeFormPresenter } from '../../feature-editing/model/useAttributeFormPresenter';
import { usePersonalEditingPresenter } from './usePersonalEditingPresenter';
import { keys, MAP_CHANGED_COPY, useMapDetail } from './queries';
import { expandMap, getMyMaps, resetMyMapsStore, toggleCollapsed, toggleExpanded } from './myMaps.store';

const layer = (over: Record<string, unknown>) => ({
  id: 'l', kind: 'free', title: 'Lớp', position: 0, style: {}, geometryType: 'point', fields: [],
  layerKey: null, draftId: null, featureCount: 0, raster: null, ...over,
});
const FIELDS = [{ name: 'Tên', type: 'text' }, { name: 'Độ sâu', type: 'number' }, { name: 'Ngày', type: 'date' }];
const DETAIL = {
  id: 'm1', title: 'Lũ', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 4,
  updatedAt: '2026-10-01T00:00:00Z', layerCount: 4, role: 'owner',
  layers: [
    layer({ id: 'l1', title: 'Điểm ngập', fields: FIELDS }),
    layer({ id: 'c1', kind: 'edit_copy', title: 'Sửa lớp Đập', geometryType: null, layerKey: 'dams', draftId: 'd1', position: 1 }),
    layer({ id: 'imp', title: 'Vùng nhập', geometryType: 'polygon', position: 2 }),
    layer({ id: 'mixed', title: 'Hỗn hợp', geometryType: null, position: 3 }),
    layer({ id: 'r1', kind: 'raster', title: 'Ảnh', geometryType: null, position: 4 }),
  ],
};
const POINT = { type: 'Point', coordinates: [108.2, 16.05] };

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function setup() {
  // The panel keeps an expanded map's detail observed, so a write's refetch lands in the cache.
  return renderHook(() => { useMapDetail('m1'); return usePersonalEditingPresenter(); }, { wrapper });
}
const click = () => act(() => { h.handlers.get('singleclick')!({ pixel: [5, 5], coordinate: [0, 0] }); });
/** The open card has read the map; a mode then sees its layers at once. */
async function loaded(_result: { current: ReturnType<typeof usePersonalEditingPresenter> }) {
  await vi.waitFor(() => expect(client.getQueryData(keys.map('m1'))).toBeTruthy());
}

beforeEach(() => {
  [getMap, listMaps, addFeature, updateFeature, removeFeature, refreshPersonalLayer, startDraw, cancelDraw,
    startModifyFeature, cancelModify, officialCreate, officialUpdate].forEach((m) => m.mockReset());
  personalFeatureAt.mockImplementation(() => h.hit);
  h.handlers.clear();
  h.hit = null;
  resetMyMapsStore();
  resetShell();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  getMap.mockResolvedValue(DETAIL);
  listMaps.mockResolvedValue({ mine: [], sharedWithMe: [] });
  expandMap('m1');
});

describe('usePersonalEditingPresenter: Vẽ thêm', () => {
  it('drawing into a free layer posts the geometry and the typed fields, then refreshes the layer', async () => {
    addFeature.mockResolvedValue({ feature: { id: '17' }, revision: 5 });
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startDrawMode('m1'));
    expect(result.current.step).toBe('pick');
    expect(getMyMaps().personalEditing).toBe(true);
    // Free layers with a geometry type and edit copies; not a mixed import or a raster.
    expect(result.current.drawable.map((l) => l.id)).toEqual(['l1', 'c1', 'imp']);
    act(() => result.current.pickLayer('l1'));
    expect(result.current.step).toBe('drawing');
    expect(startDraw).toHaveBeenCalledWith('Point', expect.any(Function));
    act(() => startDraw.mock.calls[0][1](POINT));
    expect(result.current.step).toBe('form');
    expect(result.current.freeFields).toEqual(FIELDS);
    act(() => {
      result.current.setFreeValue('Tên', 'Cống A');
      result.current.setFreeValue('Độ sâu', '2.5');
      result.current.setFreeValue('Ngày', '2026-10-01');
    });
    await act(async () => { await result.current.submitFree(); });
    expect(addFeature).toHaveBeenCalledWith('m1', 'l1', {
      geometry: POINT, properties: { 'Tên': 'Cống A', 'Độ sâu': 2.5, 'Ngày': '2026-10-01' }, expectedRevision: 4,
    });
    expect(refreshPersonalLayer).toHaveBeenCalledWith(MAP, 'l1');
    expect(cancelDraw).toHaveBeenCalled();
    expect(result.current.step).toBeNull();
    expect(getMyMaps().personalEditing).toBe(false);
  });

  it("an edit copy draws the official layer's geometry; a polygon layer draws a polygon", async () => {
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startDrawMode('m1'));
    act(() => result.current.pickLayer('c1'));
    expect(startDraw).toHaveBeenLastCalledWith('Point', expect.any(Function));
    act(() => result.current.leave());
    act(() => result.current.startDrawMode('m1'));
    act(() => result.current.pickLayer('imp'));
    // MultiPolygon is drawn as a single Polygon by the DrawController.
    expect(startDraw).toHaveBeenLastCalledWith('MultiPolygon', expect.any(Function));
  });

  it('MAP_CHANGED reloads the map and keeps the typed values', async () => {
    addFeature.mockRejectedValueOnce(new ApiError(409, 'MAP_CHANGED', 'stale'));
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startDrawMode('m1'));
    act(() => result.current.pickLayer('l1'));
    act(() => startDraw.mock.calls[0][1](POINT));
    act(() => result.current.setFreeValue('Tên', 'Cống A'));
    getMap.mockResolvedValue({ ...DETAIL, revision: 9 });
    const reads = getMap.mock.calls.length;
    await act(async () => { await result.current.submitFree(); });
    expect(getMap.mock.calls.length).toBeGreaterThan(reads);
    expect(result.current.freeError).toBe(MAP_CHANGED_COPY);
    expect(result.current.freeValues['Tên']).toBe('Cống A');
    expect(result.current.step).toBe('form');
    expect(refreshPersonalLayer).not.toHaveBeenCalled();
    // The retry sends the revision of the new read.
    addFeature.mockResolvedValue({ feature: { id: '18' }, revision: 10 });
    await act(async () => { await result.current.submitFree(); });
    expect(addFeature).toHaveBeenLastCalledWith('m1', 'l1', expect.objectContaining({ expectedRevision: 9 }));
    expect(result.current.freeError).toBeNull();
  });

  it('Sửa hình on a new drawing reshapes a copy of it and saves the reshaped geometry', async () => {
    addFeature.mockResolvedValue({ feature: { id: '17' }, revision: 5 });
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startDrawMode('m1'));
    act(() => result.current.pickLayer('l1'));
    act(() => startDraw.mock.calls[0][1](POINT));
    cancelDraw.mockClear();
    act(() => result.current.reshape());
    expect(cancelDraw).toHaveBeenCalled();
    expect(startModifyFeature).toHaveBeenCalledWith({ geometry: POINT }, expect.any(Function));
    expect(result.current.reshaping).toBe(true);
    const moved = { type: 'Point', coordinates: [108.3, 16.1] };
    act(() => startModifyFeature.mock.calls[0][1](moved));
    await act(async () => { await result.current.submitFree(); });
    expect(addFeature).toHaveBeenCalledWith('m1', 'l1', expect.objectContaining({ geometry: moved }));
    expect(cancelModify).toHaveBeenCalled();
  });
});

describe('usePersonalEditingPresenter: Sửa đối tượng', () => {
  it('an edit-copy feature is saved through the workspace route, not /api/layers', async () => {
    updateFeature.mockResolvedValue({ feature: { id: 'u-1' }, revision: 5, warnings: [] });
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startEditMode('m1'));
    expect(result.current.step).toBe('select');
    h.hit = {
      mapId: 'm1', layerId: 'c1',
      feature: { id: 'u-1', geometry: POINT, properties: { external_id: 'D1', name: 'Hoà Bình', managing_unit: '48', wattage_mw: 1920 } },
    };
    click();
    expect(personalFeatureAt).toHaveBeenCalledWith(MAP, [5, 5], 'm1');
    expect(result.current.step).toBe('form');
    const copy = result.current.editCopy!;
    expect(copy.layerKey).toBe('dams');
    expect(copy.initialValues).toEqual(expect.objectContaining({ name: 'Hoà Bình', wattage_mw: '1920', managing_unit: '48' }));
    const form = renderHook(() => useAttributeFormPresenter({
      layerKey: copy.layerKey, attributes: copy.attributes, geometry: result.current.geometryToSave,
      mode: 'edit', featureId: copy.featureId, initialValues: copy.initialValues,
      onSaved: result.current.onSaved, save: result.current.saveEditCopy, anyUnit: true,
    }), { wrapper });
    act(() => form.result.current.setField('name', 'Hoà Bình 2'));
    await act(async () => { await form.result.current.submit(); });
    expect(updateFeature).toHaveBeenCalledWith('m1', 'c1', 'u-1', {
      properties: expect.objectContaining({ name: 'Hoà Bình 2' }), expectedRevision: 4,
    });
    expect(officialUpdate).not.toHaveBeenCalled();
    expect(officialCreate).not.toHaveBeenCalled();
    expect(refreshPersonalLayer).toHaveBeenCalledWith(MAP, 'c1');
    // After a save the mode stays, ready for the next feature.
    expect(result.current.step).toBe('select');
  });

  it('opening Sửa đối tượng closes Biên tập, and opening Biên tập leaves it', async () => {
    const { result } = setup();
    await loaded(result);
    act(() => openTool('edit'));
    act(() => result.current.startEditMode('m1'));
    expect(getShell().tool).toBeNull();
    expect(getMyMaps().personalEditing).toBe(true);
    act(() => openTool('edit'));
    expect(result.current.step).toBeNull();
    expect(getMyMaps().personalEditing).toBe(false);
    // Vẽ thêm closes it too.
    act(() => result.current.startDrawMode('m1'));
    expect(getShell().tool).toBeNull();
  });

  it('deleting asks first', async () => {
    removeFeature.mockResolvedValue({ revision: 5 });
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startEditMode('m1'));
    h.hit = { mapId: 'm1', layerId: 'l1', feature: { id: '17', geometry: POINT, properties: { 'Tên': 'A' } } };
    click();
    act(() => result.current.requestDelete());
    expect(result.current.confirmOpen).toBe(true);
    expect(removeFeature).not.toHaveBeenCalled();
    act(() => result.current.cancelDelete());
    expect(result.current.confirmOpen).toBe(false);
    act(() => result.current.requestDelete());
    await act(async () => { await result.current.confirmDelete(); });
    expect(removeFeature).toHaveBeenCalledWith('m1', 'l1', '17', 4);
    expect(refreshPersonalLayer).toHaveBeenCalledWith(MAP, 'l1');
    expect(result.current.confirmOpen).toBe(false);
    expect(result.current.step).toBe('select');
  });

  it('a free layer with declared fields edits them typed; clearing one sends null', async () => {
    updateFeature.mockResolvedValue({ feature: { id: '17' }, revision: 5 });
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startEditMode('m1'));
    h.hit = { mapId: 'm1', layerId: 'l1', feature: { id: '17', geometry: POINT, properties: { 'Tên': 'A', 'Độ sâu': 1.5, 'Ngày': null } } };
    click();
    expect(result.current.freeValues).toEqual({ 'Tên': 'A', 'Độ sâu': '1.5', 'Ngày': '' });
    act(() => { result.current.setFreeValue('Độ sâu', '3'); result.current.setFreeValue('Tên', ''); });
    await act(async () => { await result.current.submitFree(); });
    // No geometry key: the shape was not moved, so the API keeps it.
    expect(updateFeature).toHaveBeenCalledWith('m1', 'l1', '17', {
      properties: { 'Tên': null, 'Độ sâu': 3, 'Ngày': null }, expectedRevision: 4,
    });
  });

  it('an imported layer without declared fields edits its existing keys as text, keeping untouched values', async () => {
    updateFeature.mockResolvedValue({ feature: { id: '9' }, revision: 5 });
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startEditMode('m1'));
    const props = { ma: 7, ten: 'A', meta: { a: 1 } };
    h.hit = { mapId: 'm1', layerId: 'imp', feature: { id: '9', geometry: POINT, properties: props } };
    click();
    expect(result.current.freeFields).toEqual([
      { name: 'ma', type: 'text' }, { name: 'ten', type: 'text' }, { name: 'meta', type: 'text' },
    ]);
    expect(result.current.freeValues).toEqual({ ma: '7', ten: 'A', meta: '{"a":1}' });
    act(() => result.current.setFreeValue('ten', 'B'));
    await act(async () => { await result.current.submitFree(); });
    expect(updateFeature).toHaveBeenCalledWith('m1', 'imp', '9', {
      properties: { ma: 7, ten: 'B', meta: { a: 1 } }, expectedRevision: 4,
    });
  });

  it("a click on another map's feature or on nothing selects nothing", async () => {
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startEditMode('m1'));
    h.hit = null;
    click();
    expect(result.current.step).toBe('select');
  });

  it('Sửa hình on an existing feature saves the moved geometry', async () => {
    updateFeature.mockResolvedValue({ feature: { id: '17' }, revision: 5 });
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startEditMode('m1'));
    h.hit = { mapId: 'm1', layerId: 'l1', feature: { id: '17', geometry: POINT, properties: {} } };
    click();
    expect(result.current.geometryToSave).toBeNull();
    act(() => result.current.reshape());
    expect(cancelDraw).not.toHaveBeenCalled();
    const moved = { type: 'Point', coordinates: [108.3, 16.1] };
    act(() => startModifyFeature.mock.calls[0][1](moved));
    expect(result.current.geometryToSave).toEqual(moved);
    await act(async () => { await result.current.submitFree(); });
    expect(updateFeature).toHaveBeenCalledWith('m1', 'l1', '17', expect.objectContaining({ geometry: moved }));
  });
});

describe('usePersonalEditingPresenter: leaving the mode', () => {
  it('closing the map card cancels a drawing and leaves the mode', async () => {
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startDrawMode('m1'));
    act(() => result.current.pickLayer('l1'));
    act(() => toggleExpanded('m1'));
    expect(result.current.step).toBeNull();
    expect(cancelDraw).toHaveBeenCalled();
    expect(getMyMaps().personalEditing).toBe(false);
  });

  it('collapsing the section leaves the mode', async () => {
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startEditMode('m1'));
    act(() => toggleCollapsed());
    expect(result.current.step).toBeNull();
    expect(h.handlers.has('singleclick')).toBe(false);
  });

  it('unmounting (signing out) cancels a drawing and clears the flag', async () => {
    const { result, unmount } = setup();
    await loaded(result);
    act(() => result.current.startDrawMode('m1'));
    act(() => result.current.pickLayer('l1'));
    unmount();
    expect(cancelDraw).toHaveBeenCalled();
    expect(getMyMaps().personalEditing).toBe(false);
  });

  it('leaving without having drawn does not cancel a drawing it does not own', async () => {
    const { result } = setup();
    await loaded(result);
    act(() => result.current.startEditMode('m1'));
    act(() => result.current.leave());
    expect(cancelDraw).not.toHaveBeenCalled();
    expect(cancelModify).not.toHaveBeenCalled();
  });
});
