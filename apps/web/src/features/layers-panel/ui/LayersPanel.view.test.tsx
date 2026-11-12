import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { LayersPanelView } from './LayersPanel.view';
import { filterPanelGroups, type PanelGroup } from '../model/useLayersPanel';

const groups: PanelGroup[] = [
  {
    name: 'Tài nguyên nước',
    on: 1,
    total: 2,
    layers: [
      { id: 'layer_dams', name: 'Đập & Hồ chứa', visible: true, opacity: 1, gated: false, swatch: { label: 'Đập', swatch: '#123456', shape: 'dot' } },
      { id: 'layer_lakes', name: 'Hồ & Hồ chứa', visible: false, opacity: 0.85, gated: true, scaleNote: 'từ 1:1.570.000', swatch: null },
    ],
  },
  {
    name: 'Ranh giới hành chính',
    on: 0,
    total: 1,
    layers: [{ id: 'layer_wards_2026', name: 'Ranh giới Xã/Phường', visible: false, opacity: 1, gated: false, scaleNote: 'từ 1:555.000' }],
  },
];

const contourSettings = { interval: 'auto' as const, labels: true };

type Props = ComponentProps<typeof LayersPanelView>;
const base: Props = {
  groups,
  onCount: 1,
  onTurnAllOff: vi.fn(),
  query: '',
  onQuery: vi.fn(),
  missingDisplay: [],
  onToggle: vi.fn(),
  onOpacity: vi.fn(),
  contourSettings,
  onContourSettings: vi.fn(),
};
const ui = (props: Partial<Props> = {}) => <LayersPanelView {...base} {...props} />;

/** The panel with its filter wired, as the container wires it. */
function Filtered() {
  const [query, setQuery] = useState('');
  return ui({ groups: filterPanelGroups(groups, query), query, onQuery: setQuery });
}

describe('LayersPanelView', () => {
  it('is a converted scope: the section and each row carry a data-slot', () => {
    const { container } = render(ui());
    expect(screen.getByRole('region', { name: 'Quản lý dữ liệu' })).toHaveAttribute('data-slot', 'layers-panel');
    expect(container.querySelectorAll('[data-slot="layer-row"]')).toHaveLength(3);
  });

  it('says how many layers are on, and Tắt hết turns them off', async () => {
    const onTurnAllOff = vi.fn();
    const { rerender } = render(ui({ onTurnAllOff }));
    const title = screen.getByRole('heading', { name: 'Quản lý dữ liệu' }).parentElement as HTMLElement;
    expect(title).toHaveTextContent('1 lớp bật');
    await userEvent.click(screen.getByRole('button', { name: 'Tắt hết' }));
    expect(onTurnAllOff).toHaveBeenCalledTimes(1);
    rerender(ui({ onTurnAllOff, onCount: 0 }));
    expect(screen.getByRole('button', { name: 'Tắt hết' })).toBeDisabled();
  });

  it('shows on/total on each group bar, and the bar folds its group away', async () => {
    render(ui());
    const water = screen.getByRole('button', { name: /Tài nguyên nước/ });
    expect(water).toHaveTextContent('1/2');
    expect(screen.getByRole('button', { name: /Ranh giới hành chính/ })).toHaveTextContent('0/1');
    expect(water).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(water);
    expect(water).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox', { name: 'Đập & Hồ chứa' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Ranh giới Xã/Phường' })).toBeInTheDocument();
  });

  it('narrows rows by name without regard to accents or case', async () => {
    const user = userEvent.setup();
    render(<Filtered />);
    await user.type(screen.getByRole('searchbox', { name: 'Lọc lớp' }), 'HO CHUA');
    expect(screen.getAllByRole('checkbox').map((c) => c.id && document.querySelector(`label[for="${c.id}"]`)?.textContent))
      .toEqual(['Đập & Hồ chứa', 'Hồ & Hồ chứa']);
    expect(screen.queryByRole('button', { name: /Ranh giới hành chính/ })).toBeNull();
  });

  it('says so when the filter matches no layer (Review Focus 2)', async () => {
    const user = userEvent.setup();
    render(<Filtered />);
    await user.type(screen.getByRole('searchbox', { name: 'Lọc lớp' }), 'không có lớp này');
    expect(screen.getByRole('status')).toHaveTextContent('Không có lớp phù hợp.');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('shows a filtered group open even after it was folded', async () => {
    const user = userEvent.setup();
    render(<Filtered />);
    await user.click(screen.getByRole('button', { name: /Tài nguyên nước/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Lọc lớp' }), 'đập');
    expect(screen.getByRole('checkbox', { name: 'Đập & Hồ chứa' })).toBeInTheDocument();
  });

  it('notes the scale a limited layer draws from, and marks it while the map is too far out (Review Focus 4)', () => {
    const { container } = render(ui());
    const lakes = container.querySelector('[data-layer="layer_lakes"]') as HTMLElement;
    expect(within(lakes).getByText('từ 1:1.570.000')).toHaveAttribute('title', 'Chưa hiện ở tỷ lệ này');
    expect(lakes).toHaveAttribute('data-gated', 'true');
    const wards = container.querySelector('[data-layer="layer_wards_2026"]') as HTMLElement;
    expect(within(wards).getByText('từ 1:555.000')).not.toHaveAttribute('title');
    expect(wards).not.toHaveAttribute('data-gated');
  });

  it('gives each row a checkbox, a swatch, an opacity control while on and an info button', async () => {
    const onToggle = vi.fn();
    const onOpacity = vi.fn();
    const onInfo = vi.fn();
    const { container } = render(ui({ onToggle, onOpacity, onInfo }));
    const dams = container.querySelector('[data-layer="layer_dams"]') as HTMLElement;
    const box = within(dams).getByRole('checkbox', { name: 'Đập & Hồ chứa' });
    expect(box).toHaveAttribute('aria-checked', 'true');
    expect(dams.querySelector('[data-shape="dot"]')).toHaveStyle({ background: '#123456' });
    fireEvent.change(within(dams).getByRole('slider', { name: 'Độ mờ Đập & Hồ chứa' }), { target: { value: '0.5' } });
    expect(onOpacity).toHaveBeenCalledWith('layer_dams', 0.5);
    await userEvent.click(within(dams).getByRole('button', { name: 'Thuộc tính của Đập & Hồ chứa' }));
    expect(onInfo).toHaveBeenCalledWith('layer_dams', 'Đập & Hồ chứa');
    await userEvent.click(box);
    expect(onToggle).toHaveBeenCalledWith('layer_dams');
    // Off, or gated: no opacity control.
    expect(screen.queryByRole('slider', { name: 'Độ mờ Hồ & Hồ chứa' })).toBeNull();
  });

  it('a click on the name toggles the layer too', async () => {
    const onToggle = vi.fn();
    render(ui({ onToggle }));
    await userEvent.click(screen.getByText('Ranh giới Xã/Phường'));
    expect(onToggle).toHaveBeenCalledWith('layer_wards_2026');
  });

  it('warns about catalog layers that have no display metadata, and is quiet otherwise', () => {
    const { rerender } = render(ui());
    expect(screen.queryByRole('status')).toBeNull();
    rerender(ui({ missingDisplay: ['layer_x', 'layer_y'] }));
    expect(screen.getByRole('status')).toHaveTextContent('2 lớp có trong hệ thống nhưng chưa có mô tả hiển thị: layer_x, layer_y');
  });

  it('offers interval and label options only for the contour row, and only when it is on', () => {
    const contours = (visible: boolean): PanelGroup[] => [{
      name: 'Địa hình', on: visible ? 1 : 0, total: 1,
      layers: [{ id: 'layer_contours', name: 'Đường đồng mức', visible, opacity: 0.8, gated: false }],
    }];
    const { rerender } = render(ui({ groups: contours(true) }));
    expect(screen.getByLabelText('Khoảng cao đều')).toBeInTheDocument();
    expect(screen.getByLabelText('Nhãn độ cao')).toBeInTheDocument();
    rerender(ui({ groups: contours(false) }));
    expect(screen.queryByLabelText('Khoảng cao đều')).toBeNull();
  });

  it('a row without a dictionary entry has no info button', () => {
    render(ui({
      onInfo: vi.fn(),
      groups: [{ name: 'G', on: 0, total: 1, layers: [{ id: 'layer_bm_roads', name: 'Giao thông', visible: false, opacity: 1, gated: false }] }],
    }));
    expect(screen.queryByRole('button', { name: 'Thuộc tính của Giao thông' })).toBeNull();
  });
});
