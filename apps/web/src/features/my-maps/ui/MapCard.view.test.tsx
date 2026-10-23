import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapCardView } from './MapCard.view';
import type { LayerRowData, MapCardData } from '../model/useMyMapsPanelPresenter';

const row: LayerRowData = {
  id: 'a', kind: 'free', title: 'Vẽ', kindLabel: 'Lớp vẽ', visible: true, opacity: 1, truncated: null,
  style: { color: '#d9480f', width: 2, fillOpacity: 0.25, pointRadius: 6 }, geometryType: 'point', fields: [],
  isFirst: true, isLast: true,
};
const card = (over: Partial<MapCardData> = {}): MapCardData => ({
  id: 'm1', title: 'Lũ', ownerLabel: null, layerCount: 1, expanded: true, canWrite: true, layers: [row], ...over,
});
const noop = vi.fn();
const props = {
  onToggle: noop, onRename: noop, onDelete: noop, onUpload: noop, onLayerVisible: noop, onLayerOpacity: noop,
  onAddLayer: noop, onLayerSettings: noop, onLayerTable: noop, onExport: noop, onShare: noop, onCopy: noop,
};
const openMenu = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Thao tác khác' }));
const menuLabels = () => screen.getAllByRole('menuitem').map((i) => i.textContent);

describe('MapCardView export', () => {
  it('a recipient can export', async () => {
    const onExport = vi.fn();
    const user = userEvent.setup();
    render(<ul><MapCardView card={card({ canWrite: false, ownerLabel: 'của Lan' })} {...props} onExport={onExport} /></ul>);
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Tải xuống' }));
    expect(onExport).toHaveBeenCalled();
  });

  it('the owner can export too', async () => {
    render(<ul><MapCardView card={card()} {...props} /></ul>);
    await openMenu(userEvent.setup());
    expect(screen.getByRole('menuitem', { name: 'Tải xuống' })).toBeInTheDocument();
  });

  it('a collapsed card keeps its menu but shows no buttons or layers', async () => {
    render(<ul><MapCardView card={card({ expanded: false })} {...props} /></ul>);
    expect(screen.queryByRole('button', { name: 'Thêm lớp' })).toBeNull();
    await openMenu(userEvent.setup());
    expect(screen.getByRole('menuitem', { name: 'Tải xuống' })).toBeInTheDocument();
  });
});

describe('MapCardView layer actions', () => {
  it('Thêm lớp opens a menu with both ways to add a layer', async () => {
    const onAddLayer = vi.fn();
    const user = userEvent.setup();
    render(<ul><MapCardView card={card()} {...props} onAddLayer={onAddLayer} /></ul>);
    await user.click(screen.getByRole('button', { name: 'Thêm lớp' }));
    await user.click(screen.getByRole('button', { name: 'Sửa một lớp chính thức' }));
    expect(onAddLayer).toHaveBeenCalledWith('edit_copy');
    await user.click(screen.getByRole('button', { name: 'Thêm lớp' }));
    await user.click(screen.getByRole('button', { name: 'Lớp vẽ mới' }));
    expect(onAddLayer).toHaveBeenLastCalledWith('drawn');
  });

  it('a layer row opens its settings', async () => {
    const onLayerSettings = vi.fn();
    render(<ul><MapCardView card={card()} {...props} onLayerSettings={onLayerSettings} /></ul>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thiết lập lớp Vẽ' }));
    expect(onLayerSettings).toHaveBeenCalledWith('a');
  });

  it('a recipient sees no layer actions', () => {
    render(<ul><MapCardView card={card({ canWrite: false, ownerLabel: 'của Lan' })} {...props} /></ul>);
    expect(screen.queryByRole('button', { name: 'Thêm lớp' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tải tệp lên' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Thiết lập lớp/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Vẽ/ })).toBeInTheDocument();
  });
});

describe('MapCardView sharing', () => {
  it('the owner can share, and has no copy item', async () => {
    const onShare = vi.fn();
    const user = userEvent.setup();
    render(<ul><MapCardView card={card()} {...props} onShare={onShare} /></ul>);
    await openMenu(user);
    expect(screen.queryByRole('menuitem', { name: 'Tạo bản sao' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Chia sẻ' }));
    expect(onShare).toHaveBeenCalled();
  });

  it('a recipient can copy, and cannot share', async () => {
    const onCopy = vi.fn();
    const user = userEvent.setup();
    render(<ul><MapCardView card={card({ canWrite: false, ownerLabel: 'của Lan' })} {...props} onCopy={onCopy} /></ul>);
    await openMenu(user);
    expect(screen.queryByRole('menuitem', { name: 'Chia sẻ' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Tạo bản sao' }));
    expect(onCopy).toHaveBeenCalled();
  });
});

describe('MapCardView tidy card', () => {
  it('the owner card shows two buttons and the menu holds Tải xuống, Chia sẻ, Đổi tên, Xoá bản đồ', async () => {
    const user = userEvent.setup();
    render(<ul><MapCardView card={card({ layers: [] })} {...props} /></ul>);
    const buttons = within(screen.getByRole('listitem')).getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(expect.arrayContaining(['Tải tệp lên', 'Thêm lớp']));
    for (const gone of ['Tải xuống', 'Chia sẻ', 'Đổi tên', 'Xoá bản đồ', 'Tải tệp lên vào bản đồ này']) {
      expect(screen.queryByRole('button', { name: gone })).toBeNull();
    }
    await openMenu(user);
    expect(menuLabels()).toEqual(['Tải xuống', 'Chia sẻ', 'Đổi tên', 'Xoá bản đồ']);
    expect(screen.getByRole('menuitem', { name: 'Xoá bản đồ' })).toHaveClass('danger');
  });

  it("a recipient's menu holds Tải xuống and Tạo bản sao only", async () => {
    render(<ul><MapCardView card={card({ canWrite: false, ownerLabel: 'của Lan' })} {...props} /></ul>);
    await openMenu(userEvent.setup());
    expect(menuLabels()).toEqual(['Tải xuống', 'Tạo bản sao']);
  });

  it('the header shows the layer count, and Tải tệp lên calls its handler', async () => {
    const onUpload = vi.fn();
    render(<ul><MapCardView card={card({ layerCount: 4 })} {...props} onUpload={onUpload} /></ul>);
    expect(screen.getByText('4 lớp')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tải tệp lên' }));
    expect(onUpload).toHaveBeenCalled();
  });

  it("a raster row has no Bảng; Bảng opens that layer's table", async () => {
    const onLayerTable = vi.fn();
    const raster = { ...row, id: 'r', kind: 'raster' as const, title: 'Ảnh' };
    const edit = { ...row, id: 'e', kind: 'edit_copy' as const, title: 'Sông' };
    render(<ul><MapCardView card={card({ layers: [row, edit, raster] })} {...props} onLayerTable={onLayerTable} /></ul>);
    expect(screen.getAllByRole('button', { name: /^Bảng/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Bảng Ảnh' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bảng Sông' }));
    expect(onLayerTable).toHaveBeenCalledWith('e');
  });

  it('a recipient also gets Bảng on a free layer', () => {
    render(<ul><MapCardView card={card({ canWrite: false, ownerLabel: 'của Lan' })} {...props} /></ul>);
    expect(screen.getByRole('button', { name: 'Bảng Vẽ' })).toBeInTheDocument();
  });

  it('the card no longer shows Vẽ thêm or Sửa đối tượng', () => {
    render(<ul><MapCardView card={card()} {...props} /></ul>);
    expect(screen.queryByText('Vẽ thêm')).toBeNull();
    expect(screen.queryByText('Sửa đối tượng')).toBeNull();
  });
});

describe('MapCardView copying', () => {
  it('while a copy runs the menu item is disabled and labelled Đang sao chép…', async () => {
    const onCopy = vi.fn();
    const user = userEvent.setup();
    render(<ul><MapCardView card={card({ canWrite: false, ownerLabel: 'của Lan', copying: true })} {...props} onCopy={onCopy} /></ul>);
    await openMenu(user);
    const item = screen.getByRole('menuitem', { name: 'Đang sao chép…' });
    expect(item).toBeDisabled();
    expect(screen.queryByRole('menuitem', { name: 'Tạo bản sao' })).toBeNull();
    await user.click(item);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it('the header shows a spinner while copying', () => {
    const copying = card({ canWrite: false, ownerLabel: 'của Lan', copying: true });
    const { rerender } = render(<ul><MapCardView card={copying} {...props} /></ul>);
    expect(screen.getByRole('status', { name: 'Đang sao chép' })).toBeInTheDocument();
    rerender(<ul><MapCardView card={{ ...copying, copying: false }} {...props} /></ul>);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
