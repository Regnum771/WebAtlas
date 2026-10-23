import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewLayerDialogView } from './NewLayerDialog.view';
import { EditCopyDialogView } from './EditCopyDialog.view';

describe('NewLayerDialogView', () => {
  it('submits the title, the geometry and the field rows', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    render(<NewLayerDialogView onSubmit={onSubmit} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Tên lớp'), 'Điểm ngập');
    await user.selectOptions(screen.getByLabelText('Kiểu hình'), 'Vùng');
    await user.click(screen.getByRole('button', { name: 'Thêm trường' }));
    await user.type(screen.getByLabelText('Tên trường'), 'Độ sâu');
    await user.selectOptions(screen.getByLabelText('Kiểu'), 'Số');
    await user.click(screen.getByRole('button', { name: 'Tạo lớp' }));
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Điểm ngập', geometryType: 'polygon', fields: [{ name: 'Độ sâu', type: 'number' }],
    });
  });

  it('a field row can be removed; the typed values stay when the API refuses', async () => {
    const onSubmit = vi.fn().mockResolvedValue('Bản đồ đã thay đổi ở nơi khác. Đã tải lại bản mới nhất; hãy thử lại.');
    const user = userEvent.setup();
    render(<NewLayerDialogView onSubmit={onSubmit} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Thêm trường' }));
    await user.click(screen.getByRole('button', { name: 'Xoá trường' }));
    expect(screen.queryByLabelText('Tên trường')).toBeNull();
    await user.type(screen.getByLabelText('Tên lớp'), 'Giữ');
    await user.click(screen.getByRole('button', { name: 'Tạo lớp' }));
    expect(await screen.findByText(/Bản đồ đã thay đổi ở nơi khác/)).toBeInTheDocument();
    expect(screen.getByLabelText('Tên lớp')).toHaveValue('Giữ');
  });
});

describe('EditCopyDialogView', () => {
  it('an edit copy is created from the chosen official layer', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    const options = [{ key: 'dams', name: 'Đập' }, { key: 'rivers', name: 'Sông' }];
    render(<EditCopyDialogView options={options} onSubmit={onSubmit} onClose={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Lớp chính thức'), 'Sông');
    await user.click(screen.getByRole('button', { name: 'Tạo bản sửa' }));
    expect(onSubmit).toHaveBeenCalledWith('rivers');
  });
});
