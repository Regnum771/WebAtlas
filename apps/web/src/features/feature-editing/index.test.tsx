import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor, within } from '@testing-library/react';

const bridge = vi.hoisted(() => ({
  enterEditMode: vi.fn(), startModify: vi.fn(), updateFeature: vi.fn(), deleteFeature: vi.fn(),
  startDraw: vi.fn(), cancelDraw: vi.fn(), exitEditMode: vi.fn(),
  signedIn: true,
  /** Null: admin. Otherwise a non-admin officer holding these grants. */
  officer: null as null | Array<{ permission: string; unit: string }>,
  tree: null as unknown,
}));

vi.mock('../../entities/session/model/useUnitTree', () => ({
  useUnitTree: () => bridge.tree,
  useUnitTreeStatus: () => ({ status: bridge.tree ? 'ready' : 'loading', retry: () => {} }),
}));
// admin session by default so the save-directly gate passes; `bridge.signedIn = false` ends it
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => (!bridge.signedIn
    ? { currentUser: null, status: 'anonymous', login: vi.fn(), logout: vi.fn() }
    : bridge.officer
      ? { currentUser: { id: '2', email: 'o@webatlas.test', full_name: 'O', role: 'viewer', isAdmin: false, grants: bridge.officer }, status: 'authenticated', login: vi.fn(), logout: vi.fn() }
      : { currentUser: { id: '1', email: 'a@webatlas.test', full_name: 'A', role: 'admin', isAdmin: true, grants: [] }, status: 'authenticated', login: vi.fn(), logout: vi.fn() }),
}));
// map editing bridge stub
vi.mock('../map/model/mapEditing', () => ({
  useMapEditing: () => ({
    hasMap: true, startDraw: bridge.startDraw, cancelDraw: bridge.cancelDraw, refreshLayer: vi.fn(), registerRefresh: vi.fn(),
    editing: false, enterEditMode: bridge.enterEditMode, exitEditMode: bridge.exitEditMode, startModify: bridge.startModify,
    cancelModify: vi.fn(), clearSelection: vi.fn(),
  }),
}));
// layer catalog stub
vi.mock('../../entities/layer/useLayerCatalog', () => ({
  useLayerCatalog: () => ({ data: [{ key: 'dams', geomType: 'Point', attributes: ['name', 'status'] }], isLoading: false }),
}));
vi.mock('./api/features.api', () => ({
  createFeature: vi.fn(), deleteFeature: (...a: unknown[]) => bridge.deleteFeature(...a),
  updateFeature: (...a: unknown[]) => bridge.updateFeature(...a),
  suggestManagingUnit: vi.fn(),
}));

import { buildUnitTree } from '@webatlas/shared';
import { ApiError } from '../../shared/api/apiClient';
import FeatureEditing from './index';

const TREE = buildUnitTree([
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
  { code: '51', level: 'province', parent: 'VN', name: 'Quảng Ngãi' },
]);
const grants = (unit: string, ...permissions: string[]) => permissions.map((permission) => ({ permission, unit }));

describe('FeatureEditing', () => {
  it('renders the toolbar with the layer picker and a draw control for an admin', () => {
    render(<FeatureEditing active />);
    expect(screen.getByText('Thêm đối tượng')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /dams/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /vẽ/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sửa đối tượng có sẵn/i })).toBeInTheDocument();
  });

  it('sits in the Biên tập menu as a plain block, not a glass panel', () => {
    const { container } = render(<FeatureEditing active />);
    expect(container.querySelector('.edit-toolbar')).not.toBeNull();
    expect(container.querySelector('.glass-panel')).toBeNull();
  });
});

describe('FeatureEditing: deleting', () => {
  it('asks before deleting with a red Xoá and says it cannot be recovered', () => {
    render(<FeatureEditing active />);
    fireEvent.click(screen.getByRole('button', { name: /sửa đối tượng có sẵn/i }));
    const onSelected = bridge.enterEditMode.mock.calls[0][0];
    act(() => onSelected({
      layerKey: 'dams', featureId: 'f1', geometry: { type: 'Point', coordinates: [108, 13] },
      isoProps: { id: 'f1', layerKey: 'dams', geographicalName: 'Hồ A' },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Xoá đối tượng' }));
    const dialog = screen.getByRole('dialog', { name: 'Xoá đối tượng này?' });
    expect(within(dialog).getByText('Không khôi phục được.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Xoá' })).toHaveClass('danger');
    expect(within(dialog).getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
  });
});

describe('FeatureEditing: per-feature gating for an officer', () => {
  beforeEach(() => {
    bridge.signedIn = true;
    bridge.tree = TREE;
    bridge.enterEditMode.mockReset();
    bridge.startModify.mockReset();
    bridge.updateFeature.mockReset();
    bridge.deleteFeature.mockReset();
  });
  afterEach(() => { bridge.officer = null; bridge.tree = null; });

  function selectDam(unit: string) {
    render(<FeatureEditing active />);
    fireEvent.click(screen.getByRole('button', { name: /sửa đối tượng có sẵn/i }));
    const onSelected = bridge.enterEditMode.mock.calls[0][0];
    act(() => onSelected({
      layerKey: 'dams', featureId: 'f1', geometry: { type: 'Point', coordinates: [108, 13] },
      isoProps: { id: 'f1', layerKey: 'dams', geographicalName: 'Hồ A', managingAuthority: unit },
    }));
  }

  it('a feature outside the jurisdiction: Lưu disabled, "ngoài phạm vi" shown, no Xoá', () => {
    bridge.officer = grants('48', 'feature.update', 'feature.delete', 'submission.review');
    selectDam('51');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(screen.getByText('Quảng Ngãi — ngoài phạm vi của anh/chị')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xoá đối tượng' })).toBeNull();
  });

  it('a feature inside the jurisdiction: Lưu enabled and Xoá offered with delete and review', () => {
    bridge.officer = grants('48', 'feature.update', 'feature.delete', 'submission.review');
    selectDam('48');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    expect(screen.queryByText(/ngoài phạm vi/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Xoá đối tượng' })).toBeInTheDocument();
  });

  it('hides Xoá without feature.delete on the unit', () => {
    bridge.officer = grants('48', 'feature.update', 'submission.review');
    selectDam('48');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Xoá đối tượng' })).toBeNull();
  });

  it('hides Xoá when review does not cover the unit', () => {
    bridge.officer = [...grants('VN', 'feature.update', 'feature.delete'), ...grants('48', 'submission.review')];
    selectDam('51');
    expect(screen.queryByRole('button', { name: 'Xoá đối tượng' })).toBeNull();
  });

  it('a refused delete shows the server message and the missing right, not "try again"', async () => {
    bridge.officer = grants('48', 'feature.update', 'feature.delete', 'submission.review');
    bridge.deleteFeature.mockRejectedValue(new ApiError(403, 'OUT_OF_JURISDICTION',
      'Đối tượng thuộc Quảng Ngãi; nhóm của anh/chị chỉ có quyền trong Đà Nẵng.',
      { unit: '51', permission: 'submission.review', allowed: ['48'] }));
    selectDam('48');
    fireEvent.click(screen.getByRole('button', { name: 'Xoá đối tượng' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Xoá đối tượng này?' })).getByRole('button', { name: 'Xoá' }));
    expect(await screen.findByText('Đối tượng thuộc Quảng Ngãi; nhóm của anh/chị chỉ có quyền trong Đà Nẵng.')).toBeInTheDocument();
    expect(screen.getByText('Thiếu quyền duyệt và xuất bản.')).toBeInTheDocument();
    expect(screen.queryByText('Chưa xoá được. Thử lại.')).toBeNull();
  });
});

describe('FeatureEditing: saving an edited river', () => {
  // What selection hands over for a tile river: the SIMPLIFIED shape from the geometry endpoint.
  const simplified = { type: 'MultiLineString', coordinates: [[[108, 13], [108.2, 13.2]]] };
  const moved = { type: 'MultiLineString', coordinates: [[[108, 13], [108.1, 13.05], [108.2, 13.2]]] };

  beforeEach(() => {
    bridge.enterEditMode.mockReset();
    bridge.startModify.mockReset();
    bridge.updateFeature.mockReset().mockResolvedValue({ id: 'u1' });
  });

  function selectRiver() {
    render(<FeatureEditing active />);
    fireEvent.click(screen.getByRole('button', { name: /sửa đối tượng có sẵn/i }));
    const onSelected = bridge.enterEditMode.mock.calls[0][0];
    act(() => onSelected({
      layerKey: 'rivers', featureId: 'u1', geometry: simplified,
      isoProps: { id: 'u1', layerKey: 'rivers', geographicalName: 'Sông X', streamOrder: 5 },
    }));
  }

  it('an attribute-only save sends no geometry, so the stored shape is kept', async () => {
    selectRiver();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(bridge.updateFeature).toHaveBeenCalledTimes(1));
    const [key, id, payload] = bridge.updateFeature.mock.calls[0];
    expect([key, id]).toEqual(['rivers', 'u1']);
    expect(payload).not.toHaveProperty('geometry');
    expect(payload.properties.name).toBe('Sông X');
  });

  it('a save after a Modify sends the modified geometry', async () => {
    selectRiver();
    const onGeometryChange = bridge.startModify.mock.calls[0][0];
    act(() => onGeometryChange(moved));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(bridge.updateFeature).toHaveBeenCalledTimes(1));
    expect(bridge.updateFeature.mock.calls[0][2].geometry).toEqual(moved);
  });
});

describe('FeatureEditing: closing its menu', () => {
  beforeEach(() => {
    bridge.signedIn = true;
    bridge.startDraw.mockReset();
    bridge.cancelDraw.mockReset();
    bridge.enterEditMode.mockReset();
    bridge.exitEditMode.mockReset();
  });

  function startDrawing() {
    fireEvent.change(screen.getByLabelText('Lớp'), { target: { value: 'dams' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vẽ' }));
    expect(bridge.startDraw).toHaveBeenCalledTimes(1);
  }

  it('cancels a feature drawing in progress, so reopening starts clean', () => {
    const { rerender } = render(<FeatureEditing active />);
    startDrawing();
    expect(screen.getByRole('button', { name: 'Đang vẽ' })).toBeInTheDocument();
    rerender(<FeatureEditing active={false} />);
    expect(bridge.cancelDraw).toHaveBeenCalled();
    rerender(<FeatureEditing active />);
    expect(screen.getByRole('button', { name: 'Vẽ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Huỷ' })).toBeNull();
  });

  it('leaves edit-existing mode, so reopening starts clean', () => {
    const { rerender } = render(<FeatureEditing active />);
    fireEvent.click(screen.getByRole('button', { name: 'Sửa đối tượng có sẵn' }));
    expect(screen.getByRole('button', { name: 'Thoát sửa' })).toBeInTheDocument();
    rerender(<FeatureEditing active={false} />);
    expect(bridge.exitEditMode).toHaveBeenCalledTimes(1);
    rerender(<FeatureEditing active />);
    expect(screen.getByRole('button', { name: 'Sửa đối tượng có sẵn' })).toBeInTheDocument();
  });

  it('a session that ends cancels the drawing and leaves edit-existing mode', () => {
    const onBusyChange = vi.fn();
    const { rerender } = render(<FeatureEditing active onBusyChange={onBusyChange} />);
    startDrawing();
    fireEvent.click(screen.getByRole('button', { name: 'Sửa đối tượng có sẵn' }));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    bridge.signedIn = false;
    rerender(<FeatureEditing active onBusyChange={onBusyChange} />);
    expect(screen.queryByRole('button', { name: 'Thoát sửa' })).toBeNull();
    expect(bridge.cancelDraw).toHaveBeenCalled();
    expect(bridge.exitEditMode).toHaveBeenCalledTimes(1);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('says it is busy while a feature drawing or edit-existing mode is active', () => {
    const onBusyChange = vi.fn();
    render(<FeatureEditing active onBusyChange={onBusyChange} />);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    startDrawing();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Sửa đối tượng có sẵn' }));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Thoát sửa' }));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
});
