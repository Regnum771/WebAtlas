import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyMapsPanelView } from './MyMapsPanel.view';
import type { MapCardData } from '../model/useMyMapsPanelPresenter';

const noop = vi.fn();
const base = {
  collapsed: false, loading: false, error: null, own: [], shared: [], usage: null,
  dialog: { open: false, mode: 'create' as const, mapId: null, title: '', error: null, busy: false },
  pendingDelete: false, deleteError: null, deleting: false,
  onToggleCollapsed: noop, onRetry: noop, onNewMap: noop, onToggleCard: noop, onRename: noop, onAskDelete: noop,
  onLayerVisible: noop, onLayerOpacity: noop, onDialogTitle: noop, onDialogSubmit: noop, onDialogClose: noop,
  onConfirmDelete: noop, onCancelDelete: noop, onUpload: noop, onExport: noop,
  onAddLayer: noop, onLayerSettings: noop,
};
const extra = {
  style: { color: '#d9480f', width: 2, fillOpacity: 0.25, pointRadius: 6 },
  geometryType: 'point' as const, fields: [], isFirst: false, isLast: false,
};
const card = (over: Partial<MapCardData> = {}): MapCardData => ({
  id: 'm1', title: 'Lũ Đà Nẵng', ownerLabel: null, layerCount: 3, expanded: false, canWrite: true, layers: null, ...over,
});

describe('MyMapsPanelView', () => {
  it('shows both empty states', () => {
    render(<MyMapsPanelView {...base} />);
    expect(screen.getByText('Chưa có bản đồ nào. Tạo bản đồ mới hoặc tải tệp lên.')).toBeInTheDocument();
    expect(screen.getByText('Chưa ai chia sẻ bản đồ với anh/chị.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Của tôi' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Được chia sẻ với tôi' })).toBeInTheDocument();
  });

  it('shows the quota line', () => {
    render(<MyMapsPanelView {...base} usage={{ usageBytes: 12897484, quotaBytes: 1073741824 }} />);
    expect(screen.getByText('Đã dùng 12,3 MB / 1 GB')).toBeInTheDocument();
  });

  it('an expanded card lists its layers with their kind labels', () => {
    const layers = [
      { id: 'a', kind: 'free' as const, title: 'Vẽ', kindLabel: 'Lớp vẽ', visible: true, opacity: 1, truncated: null, ...extra },
      { id: 'b', kind: 'free' as const, title: 'Nhập', kindLabel: 'Lớp từ tệp', visible: false, opacity: 1, truncated: null, ...extra },
      { id: 'c', kind: 'edit_copy' as const, title: 'Bản sao', kindLabel: 'Sửa lớp Sông', visible: true, opacity: 1, truncated: null, ...extra },
      { id: 'd', kind: 'raster' as const, title: 'Ảnh vệ tinh', kindLabel: 'Ảnh', visible: true, opacity: 1, truncated: null, ...extra },
    ];
    render(<MyMapsPanelView {...base} own={[card({ expanded: true, layers })]} />);
    for (const k of ['Lớp vẽ', 'Lớp từ tệp', 'Sửa lớp Sông', 'Ảnh']) expect(screen.getByText(k)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Nhập/ })).not.toBeChecked();
    // A hidden layer has no opacity slider.
    expect(screen.queryByRole('slider', { name: 'Độ mờ Nhập' })).toBeNull();
    expect(screen.getByRole('slider', { name: 'Độ mờ Vẽ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đổi tên' })).toBeInTheDocument();
  });

  it('a raster row has its opacity slider only, never the truncation note', () => {
    const layers = [
      { id: 'd', kind: 'raster' as const, title: 'Ảnh vệ tinh', kindLabel: 'Ảnh', visible: true, opacity: 0.4, truncated: 7, ...extra },
    ];
    render(<MyMapsPanelView {...base} own={[card({ expanded: true, layers })]} />);
    expect(screen.getByRole('slider', { name: 'Độ mờ Ảnh vệ tinh' })).toHaveValue('0.4');
    expect(screen.queryByText(/Chỉ hiện/)).toBeNull();
  });

  it('a shared card names its owner and offers no owner actions', () => {
    render(<MyMapsPanelView {...base} shared={[card({ ownerLabel: 'của Lan', canWrite: false, expanded: true, layers: [] })]} />);
    expect(screen.getByText('của Lan · 3 lớp')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đổi tên' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xoá bản đồ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tải tệp lên vào bản đồ này' })).toBeNull();
  });

  it('Tải tệp lên opens the upload into a new map; the owner card action into that map', async () => {
    const onUpload = vi.fn();
    const user = userEvent.setup();
    render(<MyMapsPanelView {...base} onUpload={onUpload} own={[card({ expanded: true, layers: [] })]} />);
    await user.click(screen.getByRole('button', { name: 'Tải tệp lên' }));
    expect(onUpload).toHaveBeenLastCalledWith(null);
    await user.click(screen.getByRole('button', { name: 'Tải tệp lên vào bản đồ này' }));
    expect(onUpload).toHaveBeenLastCalledWith('m1');
  });

  it('the title collapses the section', async () => {
    const onToggleCollapsed = vi.fn();
    render(<MyMapsPanelView {...base} onToggleCollapsed={onToggleCollapsed} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bản của tôi' }));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });
});
