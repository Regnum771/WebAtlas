import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  onAddLayer: noop, onLayerSettings: noop, onExport: noop,
};

describe('MapCardView export', () => {
  it('a recipient can export', async () => {
    const onExport = vi.fn();
    render(<ul><MapCardView card={card({ canWrite: false, ownerLabel: 'của Lan' })} {...props} onExport={onExport} /></ul>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tải xuống' }));
    expect(onExport).toHaveBeenCalled();
  });

  it('the owner can export too', () => {
    render(<ul><MapCardView card={card()} {...props} /></ul>);
    expect(screen.getByRole('button', { name: 'Tải xuống' })).toBeInTheDocument();
  });

  it('a collapsed card has no export button', () => {
    render(<ul><MapCardView card={card({ expanded: false })} {...props} /></ul>);
    expect(screen.queryByRole('button', { name: 'Tải xuống' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: /Thiết lập lớp/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Vẽ/ })).toBeInTheDocument();
  });
});
