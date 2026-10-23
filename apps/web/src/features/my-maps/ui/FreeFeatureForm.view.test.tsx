import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FreeFeatureFormView } from './FreeFeatureForm.view';

const FIELDS = [
  { name: 'Tên', type: 'text' as const },
  { name: 'Độ sâu', type: 'number' as const },
  { name: 'Ngày', type: 'date' as const },
];
const base = {
  fields: FIELDS, values: { 'Tên': 'A', 'Độ sâu': '2', 'Ngày': '' }, error: null, saving: false,
  onField: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(),
};

describe('FreeFeatureFormView', () => {
  it('one input per declared field: text, number and date', () => {
    render(<FreeFeatureFormView {...base} />);
    expect(screen.getByLabelText('Tên')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Độ sâu')).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText('Ngày')).toHaveAttribute('type', 'date');
  });

  it('typing reports the field, Lưu submits and Huỷ cancels', async () => {
    const onField = vi.fn();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<FreeFeatureFormView {...base} values={{}} onField={onField} onSubmit={onSubmit} onCancel={onCancel} />);
    await user.type(screen.getByLabelText('Tên'), 'B');
    expect(onField).toHaveBeenCalledWith('Tên', 'B');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(onSubmit).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows the error', () => {
    render(<FreeFeatureFormView {...base} error="Bản đồ đã thay đổi ở nơi khác. Đã tải lại bản mới nhất; hãy thử lại." />);
    expect(screen.getByText('Bản đồ đã thay đổi ở nơi khác. Đã tải lại bản mới nhất; hãy thử lại.')).toBeInTheDocument();
  });

  it('a recipient sees the form read-only: inputs disabled, no buttons', () => {
    render(<FreeFeatureFormView {...base} readOnly />);
    expect(screen.getByLabelText('Tên')).toBeDisabled();
    expect(screen.getByLabelText('Tên')).toHaveValue('A');
    expect(screen.getByLabelText('Độ sâu')).toBeDisabled();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
