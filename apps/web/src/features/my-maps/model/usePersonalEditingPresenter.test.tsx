import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({
  /** What the map's loaded source holds for a feature (personalFeature). */
  loaded: null as null | { type: 'Feature'; id: string; geometry: unknown; properties: Record<string, unknown> },
}));

const getMap = vi.fn();
const listMaps = vi.fn();
const listFeatures = vi.fn();
const addFeature = vi.fn();
const updateFeature = vi.fn();
const removeFeature = vi.fn();
vi.mock('../api/workspace.api', () => ({
  getMap: (id: string) => getMap(id),
  listMaps: () => listMaps(),
  listFeatures: (...a: unknown[]) => listFeatures(...a),
  addFeature: (...a: unknown[]) => addFeature(...a),
  updateFeature: (...a: unknown[]) => updateFeature(...a),
  removeFeature: (...a: unknown[]) => removeFeature(...a),
}));
const refreshPersonalLayer = vi.fn();
const personalFeature = vi.fn((..._a: unknown[]) => h.loaded);
vi.mock('./personalLayers', () => ({
  PERSONAL_READ_LIMIT: 5000,
  refreshPersonalLayer: (...a: unknown[]) => refreshPersonalLayer(...a),
  personalFeature: (...a: unknown[]) => personalFeature(...a),
}));
const MAP = { on: vi.fn(), un: vi.fn() };
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
// The code defaults, without the served copy's fetch.
vi.mock('../../dictionary', async () => {
  const shared = await vi.importActual<typeof import('@webatlas/shared')>('@webatlas/shared');
  return { useDictionary: () => shared.DICTIONARY };
});
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
import { getToasts, resetToasts } from '../../../shared/ui/toast.store';
import { getShell, openTool, resetShell } from '../../shell/model/shell.store';
import { useAttributeFormPresenter } from '../../feature-editing/model/useAttributeFormPresenter';
import type { LayerSummary } from '../api/workspace.api';
import { canDrawInto, usePersonalEditingPresenter, type TableSelection } from './usePersonalEditingPresenter';
import { keys, MAP_CHANGED_COPY, MAP_GONE_COPY, MAP_NOT_FOUND, useMapDetail } from './queries';
import { getMyMaps, resetMyMapsStore } from './myMaps.store';
import { getTableState, openTable, resetTableStore, select } from './table.store';

const layer = (over: Partial<LayerSummary>): LayerSummary => ({
  id: 'l', kind: 'free', title: 'Lớp', position: 0, style: {}, geometryType: 'point', fields: [],
  layerKey: null, draftId: null, featureCount: 0, raster: null, ...over,
});
const FIELDS = [
  { name: 'Tên', type: 'text' as const }, { name: 'Độ sâu', type: 'number' as const }, { name: 'Ngày', type: 'date' as const },
];
const L1 = layer({ id: 'l1', title: 'Điểm ngập', fields: FIELDS });
const C1 = layer({ id: 'c1', kind: 'edit_copy', title: 'Sửa lớp Đập', geometryType: null, layerKey: 'dams', draftId: 'd1', position: 1 });
const IMP = layer({ id: 'imp', title: 'Vùng nhập', geometryType: 'polygon', position: 2 });
const MIXED = layer({ id: 'mixed', title: 'Hỗn hợp', geometryType: null, position: 3 });
const DETAIL = {
  id: 'm1', title: 'Lũ', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 4,
  updatedAt: '2026-10-01T00:00:00Z', layerCount: 4, role: 'owner',
  layers: [L1, C1, IMP, MIXED],
};
const POINT = { type: 'Point', coordinates: [108.2, 16.05] };

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
/** The table's selection as useTablePresenter hands it over. */
function setup(initial: TableSelection | null = null) {
  // The table keeps its map's detail observed, so a write's refetch lands in the cache.
  return renderHook(
    ({ selection }: { selection: TableSelection | null }) => { useMapDetail('m1'); return usePersonalEditingPresenter(selection); },
    { wrapper, initialProps: { selection: initial } },
  );
}
type Hook = ReturnType<typeof setup>;
const row = (l: LayerSummary, id: string, properties: Record<string, unknown> | null, bbox: TableSelection['bbox'] = null): TableSelection =>
  ({ layer: l, id, properties, bbox });
/** A row click: the store selects it and the table hands the row over. */
function selectRow(hook: Hook, selection: TableSelection) {
  act(() => select(selection.id));
  hook.rerender({ selection });
}
async function loaded() {
  await vi.waitFor(() => expect(client.getQueryData(keys.map('m1'))).toBeTruthy());
}

beforeEach(() => {
  [getMap, listMaps, listFeatures, addFeature, updateFeature, removeFeature, refreshPersonalLayer, startDraw, cancelDraw,
    startModifyFeature, cancelModify, officialCreate, officialUpdate].forEach((m) => m.mockReset());
  personalFeature.mockImplementation(() => h.loaded);
  h.loaded = null;
  resetMyMapsStore();
  resetShell();
  resetToasts();
  resetTableStore();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  getMap.mockResolvedValue(DETAIL);
  listMaps.mockResolvedValue({ mine: [], sharedWithMe: [] });
  openTable('m1', 'l1');
});

describe('usePersonalEditingPresenter: the form beside the table', () => {
  it('selecting a row opens its form beside the table', async () => {
    const hook = setup();
    await loaded();
    expect(hook.result.current.step).toBeNull();
    selectRow(hook, row(L1, '17', { 'Tên': 'A', 'Độ sâu': 1.5, 'Ngày': null }));
    expect(hook.result.current.step).toBe('form');
    expect(hook.result.current.readOnly).toBe(false);
    expect(hook.result.current.targetKind).toBe('free');
    expect(hook.result.current.freeFields).toEqual(FIELDS);
    expect(hook.result.current.freeValues).toEqual({ 'Tên': 'A', 'Độ sâu': '1.5', 'Ngày': '' });
    // A form is not a drawing: the map's clicks stay free.
    expect(getMyMaps().personalEditing).toBe(false);

    // Another row replaces it; no selection closes it.
    selectRow(hook, row(L1, '18', { 'Tên': 'B', 'Độ sâu': 2, 'Ngày': '2026-10-01' }));
    expect(hook.result.current.freeValues['Tên']).toBe('B');
    act(() => select(null));
    hook.rerender({ selection: null });
    expect(hook.result.current.step).toBeNull();
  });

  it('a selection whose row is not read yet waits for it', async () => {
    const hook = setup();
    await loaded();
    selectRow(hook, row(L1, '180', null));
    expect(hook.result.current.step).toBeNull();
    hook.rerender({ selection: row(L1, '180', { 'Tên': 'Z' }) });
    expect(hook.result.current.step).toBe('form');
    expect(hook.result.current.freeValues['Tên']).toBe('Z');
  });

  it('openFeature opens the form of a feature without a map click', async () => {
    const hook = setup();
    await loaded();
    act(() => hook.result.current.openFeature(IMP, '9', { ma: 7, ten: 'A', meta: { a: 1 } }));
    expect(hook.result.current.step).toBe('form');
    // An imported layer without declared fields edits its existing keys as text.
    expect(hook.result.current.freeFields).toEqual([
      { name: 'ma', type: 'text' }, { name: 'ten', type: 'text' }, { name: 'meta', type: 'text' },
    ]);
    expect(hook.result.current.freeValues).toEqual({ ma: '7', ten: 'A', meta: '{"a":1}' });
  });

  it('a recipient sees the form read-only', async () => {
    getMap.mockResolvedValue({ ...DETAIL, role: 'recipient' });
    openTool('edit');
    const hook = setup();
    await loaded();
    await vi.waitFor(() => expect(hook.result.current.readOnly).toBe(true));
    selectRow(hook, row(L1, '17', { 'Tên': 'A' }));
    expect(hook.result.current.step).toBe('form');
    expect(hook.result.current.freeValues['Tên']).toBe('A');
    // Viewing is not editing: the official tool stays open.
    expect(getShell().tool).toBe('edit');
    // Nothing writes, reshapes or draws.
    await act(async () => { await hook.result.current.submitFree(); });
    await act(async () => { await hook.result.current.reshape(); });
    act(() => hook.result.current.requestDelete());
    act(() => hook.result.current.startDrawInto(L1));
    expect(updateFeature).not.toHaveBeenCalled();
    expect(startModifyFeature).not.toHaveBeenCalled();
    expect(startDraw).not.toHaveBeenCalled();
    expect(hook.result.current.confirmOpen).toBe(false);
  });
});

describe('usePersonalEditingPresenter: Vẽ thêm', () => {
  it("Vẽ thêm draws into the table's layer and selects the new feature", async () => {
    addFeature.mockResolvedValue({ feature: { id: '17' }, revision: 5 });
    openTool('edit');
    const hook = setup(row(L1, '3', { 'Tên': 'C' }));
    await loaded();
    expect(hook.result.current.step).toBe('form');
    act(() => hook.result.current.startDrawInto(L1));
    // Drawing closes Biên tập and the open row, and holds the map's clicks.
    expect(getShell().tool).toBeNull();
    expect(getTableState().selectedId).toBeNull();
    hook.rerender({ selection: null });
    expect(hook.result.current.step).toBe('drawing');
    expect(hook.result.current.drawShape).toBe('điểm');
    expect(getMyMaps().personalEditing).toBe(true);
    expect(getMyMaps().layers.l1?.visible ?? true).toBe(true);
    expect(startDraw).toHaveBeenCalledWith('Point', expect.any(Function));

    act(() => startDraw.mock.calls[0][1](POINT));
    expect(hook.result.current.step).toBe('form');
    expect(hook.result.current.isNew).toBe(true);
    act(() => {
      hook.result.current.setFreeValue('Tên', 'Cống A');
      hook.result.current.setFreeValue('Độ sâu', '2.5');
    });
    await act(async () => { await hook.result.current.submitFree(); });
    expect(addFeature).toHaveBeenCalledWith('m1', 'l1', {
      geometry: POINT, properties: { 'Tên': 'Cống A', 'Độ sâu': 2.5 }, expectedRevision: 4,
    });
    expect(refreshPersonalLayer).toHaveBeenCalledWith(MAP, 'l1');
    expect(cancelDraw).toHaveBeenCalled();
    // The new feature is the selection, and its form stays open as a stored feature.
    expect(getTableState().selectedId).toBe('17');
    hook.rerender({ selection: row(L1, '17', null) });
    expect(hook.result.current.step).toBe('form');
    expect(hook.result.current.isNew).toBe(false);
    expect(hook.result.current.freeValues['Tên']).toBe('Cống A');
    expect(getMyMaps().personalEditing).toBe(false);
  });

  it('an edit copy draws the official geometry, a polygon layer a polygon; a mixed import draws nothing', async () => {
    const hook = setup();
    await loaded();
    act(() => hook.result.current.startDrawInto(C1));
    expect(startDraw).toHaveBeenLastCalledWith('Point', expect.any(Function));
    act(() => hook.result.current.leave());
    expect(cancelDraw).toHaveBeenCalled();
    act(() => hook.result.current.startDrawInto(IMP));
    expect(startDraw).toHaveBeenLastCalledWith('MultiPolygon', expect.any(Function));
    expect([L1, C1, IMP, MIXED].map(canDrawInto)).toEqual([true, true, true, false]);
    startDraw.mockClear();
    act(() => hook.result.current.startDrawInto(MIXED));
    expect(startDraw).not.toHaveBeenCalled();
  });

  it('MAP_CHANGED reloads the map and keeps the typed values', async () => {
    addFeature.mockRejectedValueOnce(new ApiError(409, 'MAP_CHANGED', 'stale'));
    const hook = setup();
    await loaded();
    act(() => hook.result.current.startDrawInto(L1));
    act(() => startDraw.mock.calls[0][1](POINT));
    act(() => hook.result.current.setFreeValue('Tên', 'Cống A'));
    getMap.mockResolvedValue({ ...DETAIL, revision: 9 });
    const reads = getMap.mock.calls.length;
    await act(async () => { await hook.result.current.submitFree(); });
    expect(getMap.mock.calls.length).toBeGreaterThan(reads);
    expect(hook.result.current.freeError).toBe(MAP_CHANGED_COPY);
    expect(hook.result.current.freeValues['Tên']).toBe('Cống A');
    expect(hook.result.current.step).toBe('form');
    expect(refreshPersonalLayer).not.toHaveBeenCalled();
    // The retry sends the revision of the new read.
    addFeature.mockResolvedValue({ feature: { id: '18' }, revision: 10 });
    await act(async () => { await hook.result.current.submitFree(); });
    expect(addFeature).toHaveBeenLastCalledWith('m1', 'l1', expect.objectContaining({ expectedRevision: 9 }));
    expect(hook.result.current.freeError).toBeNull();
  });

  it('Sửa hình on a new drawing reshapes a copy of it and saves the reshaped geometry', async () => {
    addFeature.mockResolvedValue({ feature: { id: '17' }, revision: 5 });
    const hook = setup();
    await loaded();
    act(() => hook.result.current.startDrawInto(L1));
    act(() => startDraw.mock.calls[0][1](POINT));
    cancelDraw.mockClear();
    await act(async () => { await hook.result.current.reshape(); });
    expect(cancelDraw).toHaveBeenCalled();
    expect(startModifyFeature).toHaveBeenCalledWith({ geometry: POINT }, expect.any(Function));
    expect(hook.result.current.reshaping).toBe(true);
    const moved = { type: 'Point', coordinates: [108.3, 16.1] };
    act(() => startModifyFeature.mock.calls[0][1](moved));
    await act(async () => { await hook.result.current.submitFree(); });
    expect(addFeature).toHaveBeenCalledWith('m1', 'l1', expect.objectContaining({ geometry: moved }));
    expect(cancelModify).toHaveBeenCalled();
  });
});

describe('usePersonalEditingPresenter: saving a row', () => {
  it('a free layer with declared fields saves them typed; the row stays selected and is located again', async () => {
    updateFeature.mockResolvedValue({ feature: { id: '17' }, revision: 5 });
    const hook = setup();
    await loaded();
    selectRow(hook, row(L1, '17', { 'Tên': 'A', 'Độ sâu': 1.5, 'Ngày': null }));
    const seq = getTableState().locateSeq;
    act(() => { hook.result.current.setFreeValue('Độ sâu', '3'); hook.result.current.setFreeValue('Tên', ''); });
    await act(async () => { await hook.result.current.submitFree(); });
    // No geometry key: the shape was not moved, so the API keeps it.
    expect(updateFeature).toHaveBeenCalledWith('m1', 'l1', '17', {
      properties: { 'Tên': null, 'Độ sâu': 3, 'Ngày': null }, expectedRevision: 4,
    });
    expect(refreshPersonalLayer).toHaveBeenCalledWith(MAP, 'l1');
    expect(getTableState().selectedId).toBe('17');
    // The table asks again whether the saved feature still matches its filter.
    expect(getTableState().locateSeq).toBe(seq + 1);
    expect(hook.result.current.step).toBe('form');
    // The page read again brings the saved values into the form.
    hook.rerender({ selection: row(L1, '17', { 'Tên': null, 'Độ sâu': 3, 'Ngày': null }) });
    expect(hook.result.current.freeValues).toEqual({ 'Tên': '', 'Độ sâu': '3', 'Ngày': '' });
  });

  it('an edit-copy feature is saved through the workspace route, not /api/layers', async () => {
    updateFeature.mockResolvedValue({ feature: { id: 'u-1' }, revision: 5, warnings: [] });
    const hook = setup();
    await loaded();
    act(() => openTable('m1', 'c1'));
    selectRow(hook, row(C1, 'u-1', { external_id: 'D1', name: 'Hoà Bình', managing_unit: '48', wattage_mw: 1920 }));
    expect(hook.result.current.step).toBe('form');
    const copy = hook.result.current.editCopy!;
    expect(copy.layerKey).toBe('dams');
    expect(copy.initialValues).toEqual(expect.objectContaining({ name: 'Hoà Bình', wattage_mw: '1920', managing_unit: '48' }));
    const form = renderHook(() => useAttributeFormPresenter({
      layerKey: copy.layerKey, attributes: copy.attributes, geometry: hook.result.current.geometryToSave,
      mode: 'edit', featureId: copy.featureId, initialValues: copy.initialValues,
      onSaved: hook.result.current.onSaved, save: hook.result.current.saveEditCopy, anyUnit: true,
    }), { wrapper });
    act(() => form.result.current.setField('name', 'Hoà Bình 2'));
    await act(async () => { await form.result.current.submit(); });
    expect(updateFeature).toHaveBeenCalledWith('m1', 'c1', 'u-1', {
      properties: expect.objectContaining({ name: 'Hoà Bình 2' }), expectedRevision: 4,
    });
    expect(officialUpdate).not.toHaveBeenCalled();
    expect(officialCreate).not.toHaveBeenCalled();
    expect(refreshPersonalLayer).toHaveBeenCalledWith(MAP, 'c1');
    expect(getTableState().selectedId).toBe('u-1');
    expect(hook.result.current.step).toBe('form');
  });

  it('Sửa hình on a stored feature takes its shape from the map, else reads it, and saves the moved geometry', async () => {
    updateFeature.mockResolvedValue({ feature: { id: '17' }, revision: 5 });
    const hook = setup();
    await loaded();
    // Not on the map: read from the API around the row's box.
    listFeatures.mockResolvedValue({ type: 'FeatureCollection', truncated: false, features: [
      { type: 'Feature', id: '16', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      { type: 'Feature', id: '17', geometry: POINT, properties: {} },
    ] });
    selectRow(hook, row(L1, '17', { 'Tên': 'A' }, [108.2, 16.05, 108.2, 16.05]));
    expect(hook.result.current.geometryToSave).toBeNull();
    await act(async () => { await hook.result.current.reshape(); });
    expect(listFeatures).toHaveBeenCalledWith('m1', 'l1', expect.objectContaining({ bbox: expect.any(Array) }));
    expect(startModifyFeature).toHaveBeenCalledWith({ geometry: POINT }, expect.any(Function));
    expect(getMyMaps().personalEditing).toBe(true);
    const moved = { type: 'Point', coordinates: [108.3, 16.1] };
    act(() => startModifyFeature.mock.calls[0][1](moved));
    expect(hook.result.current.geometryToSave).toEqual(moved);
    await act(async () => { await hook.result.current.submitFree(); });
    expect(updateFeature).toHaveBeenCalledWith('m1', 'l1', '17', expect.objectContaining({ geometry: moved }));
    expect(getMyMaps().personalEditing).toBe(false);

    // On the map: no read.
    listFeatures.mockClear();
    h.loaded = { type: 'Feature', id: '18', geometry: POINT, properties: {} };
    selectRow(hook, row(L1, '18', { 'Tên': 'B' }));
    await act(async () => { await hook.result.current.reshape(); });
    expect(listFeatures).not.toHaveBeenCalled();
    expect(startModifyFeature).toHaveBeenLastCalledWith({ geometry: POINT }, expect.any(Function));
  });

  it('deleting asks first, then clears the selection', async () => {
    removeFeature.mockResolvedValue({ revision: 5 });
    const hook = setup();
    await loaded();
    selectRow(hook, row(L1, '17', { 'Tên': 'A' }));
    act(() => hook.result.current.requestDelete());
    expect(hook.result.current.confirmOpen).toBe(true);
    expect(removeFeature).not.toHaveBeenCalled();
    act(() => hook.result.current.cancelDelete());
    expect(hook.result.current.confirmOpen).toBe(false);
    act(() => hook.result.current.requestDelete());
    await act(async () => { await hook.result.current.confirmDelete(); });
    expect(removeFeature).toHaveBeenCalledWith('m1', 'l1', '17', 4);
    expect(refreshPersonalLayer).toHaveBeenCalledWith(MAP, 'l1');
    expect(hook.result.current.confirmOpen).toBe(false);
    expect(getTableState().selectedId).toBeNull();
    hook.rerender({ selection: null });
    expect(hook.result.current.step).toBeNull();
  });

  it('a map gone on a save closes the table with the message', async () => {
    updateFeature.mockRejectedValue(new ApiError(404, 'NOT_FOUND', MAP_NOT_FOUND));
    const hook = setup();
    await loaded();
    selectRow(hook, row(L1, '17', { 'Tên': 'A' }));
    await act(async () => { await hook.result.current.submitFree(); });
    expect(getTableState().open).toBeNull();
    expect(getToasts().map((t) => t.title)).toEqual([MAP_GONE_COPY]);
  });
});

describe('usePersonalEditingPresenter: one editor at a time', () => {
  it('opening Biên tập closes the form and cancels a drawing', async () => {
    const hook = setup();
    await loaded();
    act(() => hook.result.current.startDrawInto(L1));
    expect(getMyMaps().personalEditing).toBe(true);
    act(() => openTool('edit'));
    expect(hook.result.current.step).toBeNull();
    expect(cancelDraw).toHaveBeenCalled();
    expect(getMyMaps().personalEditing).toBe(false);

    // An owner's form opening closes Biên tập; Biên tập opening closes the form and the selection.
    selectRow(hook, row(L1, '17', { 'Tên': 'A' }));
    expect(getShell().tool).toBeNull();
    act(() => openTool('edit'));
    expect(hook.result.current.step).toBeNull();
    expect(getTableState().selectedId).toBeNull();
  });

  it("switching the table to another layer leaves a drawing into the old one", async () => {
    const hook = setup();
    await loaded();
    act(() => hook.result.current.startDrawInto(L1));
    act(() => openTable('m1', 'imp'));
    hook.rerender({ selection: null });
    expect(hook.result.current.step).toBeNull();
    expect(cancelDraw).toHaveBeenCalled();
  });

  it('unmounting (the table closing, signing out) cancels a drawing and clears the flag', async () => {
    const hook = setup();
    await loaded();
    act(() => hook.result.current.startDrawInto(L1));
    hook.unmount();
    expect(cancelDraw).toHaveBeenCalled();
    expect(getMyMaps().personalEditing).toBe(false);
  });

  it('Sửa đối tượng no longer exists', async () => {
    const hook = setup();
    await loaded();
    // No map-click mode: neither its entry nor its waiting step.
    expect('startEditMode' in hook.result.current).toBe(false);
    expect('startDrawMode' in hook.result.current).toBe(false);
    expect(MAP.on).not.toHaveBeenCalledWith('singleclick', expect.anything());
  });
});
