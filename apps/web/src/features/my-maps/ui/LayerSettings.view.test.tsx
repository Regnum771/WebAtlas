import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayerSettingsView } from './LayerSettings.view';
import type { LayerRowData } from '../model/useMyMapsPanelPresenter';

const layer = (over: Partial<LayerRowData> = {}): LayerRowData => ({
  id: 'a', kind: 'free', title: 'Điểm ngập', kindLabel: 'Lớp vẽ', visible: true, opacity: 1, truncated: null,
  style: { color: '#d9480f', width: 2, fillOpacity: 0.25, pointRadius: 6 }, geometryType: 'polygon',
  fields: [{ name: 'Độ sâu', type: 'number' }], isFirst: false, isLast: false, ...over,
});
const handlers = () => ({
  onRename: vi.fn().mockResolvedValue(null), onStyle: vi.fn(), onMove: vi.fn().mockResolvedValue(null),
  onSaveFields: vi.fn().mockResolvedValue(null), onRemove: vi.fn().mockResolvedValue(null), onClose: vi.fn(),
});

describe('LayerSettingsView', () => {
  it('Lên is disabled on the first layer, Xuống on the last', () => {
    const { rerender } = render(<LayerSettingsView layer={layer({ isFirst: true })} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Lên' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xuống' })).toBeEnabled();
    rerender(<LayerSettingsView layer={layer({ isLast: true })} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Lên' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Xuống' })).toBeDisabled();
  });

  it('a free polygon layer has colour, width, fill and fields; an edit copy only name, order and delete', () => {
    const { rerender } = render(<LayerSettingsView layer={layer()} {...handlers()} />);
    for (const n of ['Màu', 'Độ dày nét', 'Độ đậm vùng']) expect(screen.getByLabelText(n)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sửa trường' })).toBeInTheDocument();
    rerender(<LayerSettingsView layer={layer({ geometryType: 'point' })} {...handlers()} />);
    expect(screen.queryByLabelText('Độ đậm vùng')).toBeNull();
    rerender(<LayerSettingsView layer={layer({ kind: 'edit_copy' })} {...handlers()} />);
    expect(screen.queryByLabelText('Màu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa trường' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Đổi tên' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xoá lớp' })).toBeInTheDocument();
  });

  it('a style change is reported at once', () => {
    const h = handlers();
    render(<LayerSettingsView layer={layer()} {...h} />);
    fireEvent.change(screen.getByLabelText('Độ dày nét'), { target: { value: '5' } });
    expect(h.onStyle).toHaveBeenCalledWith({ width: 5 });
    fireEvent.change(screen.getByLabelText('Màu'), { target: { value: '#112233' } });
    expect(h.onStyle).toHaveBeenLastCalledWith({ color: '#112233' });
  });

  it('renaming sends the new title', async () => {
    const h = handlers();
    const user = userEvent.setup();
    render(<LayerSettingsView layer={layer()} {...h} />);
    const input = screen.getByLabelText('Tên lớp');
    await user.clear(input);
    await user.type(input, 'Ngập sâu');
    await user.click(screen.getByRole('button', { name: 'Đổi tên' }));
    expect(h.onRename).toHaveBeenCalledWith('Ngập sâu');
  });

  it('renaming a field sends from and the new name; the API message shows as it comes', async () => {
    const h = handlers();
    h.onSaveFields.mockResolvedValue('Không đổi kiểu được trường "Độ sâu" vì đã có giá trị.');
    const user = userEvent.setup();
    render(<LayerSettingsView layer={layer()} {...h} />);
    await user.click(screen.getByRole('button', { name: 'Sửa trường' }));
    const name = screen.getByLabelText('Tên trường');
    await user.clear(name);
    await user.type(name, 'Sâu');
    await user.click(screen.getByRole('button', { name: 'Lưu trường' }));
    expect(h.onSaveFields).toHaveBeenCalledWith([{ name: 'Sâu', type: 'number', from: 'Độ sâu' }]);
    expect(await screen.findByText('Không đổi kiểu được trường "Độ sâu" vì đã có giá trị.')).toBeInTheDocument();
    // The typed value is still there for a retry.
    expect(screen.getByLabelText('Tên trường')).toHaveValue('Sâu');
  });

  it('blanking an existing field name refuses the save and keeps the field', async () => {
    const h = handlers();
    const user = userEvent.setup();
    render(<LayerSettingsView layer={layer()} {...h} />);
    await user.click(screen.getByRole('button', { name: 'Sửa trường' }));
    await user.clear(screen.getByLabelText('Tên trường'));
    await user.click(screen.getByRole('button', { name: 'Lưu trường' }));
    expect(screen.getByText('Hãy nhập tên trường.')).toBeInTheDocument();
    expect(h.onSaveFields).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Xoá trường?' })).toBeNull();
  });

  it('a blank new row is dropped without asking', async () => {
    const h = handlers();
    const user = userEvent.setup();
    render(<LayerSettingsView layer={layer()} {...h} />);
    await user.click(screen.getByRole('button', { name: 'Sửa trường' }));
    await user.click(screen.getByRole('button', { name: 'Thêm trường' }));
    expect(screen.getAllByLabelText('Tên trường')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Lưu trường' }));
    expect(screen.queryByRole('dialog', { name: 'Xoá trường?' })).toBeNull();
    expect(h.onSaveFields).toHaveBeenCalledWith([{ name: 'Độ sâu', type: 'number', from: 'Độ sâu' }]);
  });

  it('removing a declared field asks first and saves only on Xoá', async () => {
    const h = handlers();
    const user = userEvent.setup();
    render(<LayerSettingsView layer={layer({ fields: [{ name: 'Độ sâu', type: 'number' }, { name: 'Ghi chú', type: 'text' }] })} {...h} />);
    await user.click(screen.getByRole('button', { name: 'Sửa trường' }));
    await user.click(screen.getAllByRole('button', { name: 'Xoá trường' })[0]);
    await user.click(screen.getByRole('button', { name: 'Lưu trường' }));
    const confirm = screen.getByRole('dialog', { name: 'Xoá trường?' });
    expect(within(confirm).getByText('Giá trị của các trường bị xoá trong mọi đối tượng sẽ mất. Không khôi phục được.')).toBeInTheDocument();
    expect(h.onSaveFields).not.toHaveBeenCalled();
    // Huỷ keeps the rows as they were edited, and saves nothing.
    await user.click(within(confirm).getByRole('button', { name: 'Huỷ' }));
    expect(h.onSaveFields).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText('Tên trường').map((i) => (i as HTMLInputElement).value)).toEqual(['Ghi chú']);
    await user.click(screen.getByRole('button', { name: 'Lưu trường' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Xoá trường?' })).getByRole('button', { name: 'Xoá' }));
    expect(h.onSaveFields).toHaveBeenCalledWith([{ name: 'Ghi chú', type: 'text', from: 'Ghi chú' }]);
  });

  it('deleting an edit copy shows the draft message', async () => {
    const h = handlers();
    const user = userEvent.setup();
    render(<LayerSettingsView layer={layer({ kind: 'edit_copy' })} {...h} />);
    await user.click(screen.getByRole('button', { name: 'Xoá lớp' }));
    const confirm = screen.getByRole('dialog', { name: 'Xoá lớp này?' });
    expect(within(confirm).getByText('Bản nháp sửa lớp sẽ bị huỷ. Không khôi phục được.')).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Xoá' }));
    expect(h.onRemove).toHaveBeenCalled();
  });

  it('deleting another layer says its objects go too', async () => {
    const user = userEvent.setup();
    render(<LayerSettingsView layer={layer()} {...handlers()} />);
    await user.click(screen.getByRole('button', { name: 'Xoá lớp' }));
    expect(screen.getByText('Các đối tượng trong lớp sẽ bị xoá. Không khôi phục được.')).toBeInTheDocument();
  });
});
