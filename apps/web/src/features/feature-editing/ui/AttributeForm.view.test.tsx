import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttributeFormView } from './AttributeForm.view';

const baseProps = {
  attributes: ['name', 'status'],
  labels: { name: 'geographicalName', status: 'operationalStatus' },
  values: { name: '', status: '' },
  fieldErrors: {} as Record<string, string>,
  error: null as string | null,
  canSave: true,
  saving: false,
  onField: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
};

describe('AttributeFormView', () => {
  it('renders one field per attribute with ISO labels', () => {
    render(<AttributeFormView {...baseProps} />);
    expect(screen.getByLabelText('geographicalName')).toBeInTheDocument();
    expect(screen.getByLabelText('operationalStatus')).toBeInTheDocument();
  });

  it('disables save when canSave is false', () => {
    render(<AttributeFormView {...baseProps} canSave={false} />);
    expect(screen.getByRole('button', { name: /lưu/i })).toBeDisabled();
  });

  it('calls onSubmit when the form is submitted', async () => {
    const onSubmit = vi.fn();
    render(<AttributeFormView {...baseProps} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /lưu/i }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('shows a second line under the error when there is one', () => {
    render(<AttributeFormView {...baseProps} error="Đối tượng thuộc Đà Nẵng." errorDetail="Thiếu quyền duyệt và xuất bản." />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Đối tượng thuộc Đà Nẵng.');
    expect(alert).toHaveTextContent('Thiếu quyền duyệt và xuất bản.');
  });

  it('shows a form-level error', () => {
    render(<AttributeFormView {...baseProps} error="Hình vẽ không hợp lệ. Vẽ lại." />);
    expect(screen.getByText('Hình vẽ không hợp lệ. Vẽ lại.')).toBeInTheDocument();
  });

  it('a number field shows its display unit after the input, described by it', () => {
    render(<AttributeFormView {...baseProps} attributes={['volume_mcm']} labels={{ volume_mcm: 'Dung tích' }}
      values={{ volume_mcm: '12,5' }} fields={{ volume_mcm: { unitSymbol: 'triệu m³' } }} />);
    const input = screen.getByLabelText('Dung tích');
    expect(input).toHaveValue('12,5');
    expect(screen.getByText('triệu m³')).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription('triệu m³');
  });

  it('a field error stays next to its field, with the unit still described', () => {
    render(<AttributeFormView {...baseProps} attributes={['length_m']} labels={{ length_m: 'Chiều dài' }}
      values={{ length_m: '12.5' }} fields={{ length_m: { unitSymbol: 'km' } }}
      fieldErrors={{ length_m: 'Không đọc được số "12.5".' }} />);
    const input = screen.getByLabelText('Chiều dài');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/km/);
    expect(input).toHaveAccessibleDescription(/Không đọc được số/);
  });

  it('a code field is a select of value names, with an empty choice', async () => {
    const onField = vi.fn();
    render(<AttributeFormView {...baseProps} values={{ name: '', status: 'binh_thuong' }} onField={onField}
      labels={{ name: 'Tên', status: 'Trạng thái' }}
      fields={{ status: { options: [{ value: 'binh_thuong', label: 'Bình thường' }, { value: 'xa_lu', label: 'Xả lũ' }] } }} />);
    const select = screen.getByRole('combobox', { name: 'Trạng thái' });
    expect(select).toHaveValue('binh_thuong');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['—', 'Bình thường', 'Xả lũ']);
    await userEvent.selectOptions(select, 'Xả lũ');
    expect(onField).toHaveBeenCalledWith('status', 'xa_lu');
  });

  it('an unknown code keeps its option in the form select', () => {
    render(<AttributeFormView {...baseProps} values={{ name: '', status: 'dang_xay' }}
      labels={{ name: 'Tên', status: 'Trạng thái' }}
      fields={{ status: { options: [{ value: 'binh_thuong', label: 'Bình thường' }, { value: 'dang_xay', label: 'dang_xay' }] } }} />);
    expect(screen.getByRole('combobox', { name: 'Trạng thái' })).toHaveValue('dang_xay');
    expect(screen.getByRole('option', { name: 'dang_xay' })).toBeInTheDocument();
  });

  it('read-only: a select is disabled too', () => {
    render(<AttributeFormView {...baseProps} values={{ name: '', status: 'xa_lu' }} readOnly
      labels={{ name: 'Tên', status: 'Trạng thái' }}
      fields={{ status: { options: [{ value: 'xa_lu', label: 'Xả lũ' }] } }} />);
    expect(screen.getByRole('combobox', { name: 'Trạng thái' })).toBeDisabled();
  });

  it('read-only: inputs disabled, no buttons', () => {
    render(<AttributeFormView {...baseProps} values={{ name: 'Hoà Bình', status: '' }} readOnly />);
    expect(screen.getByLabelText('geographicalName')).toBeDisabled();
    expect(screen.getByLabelText('geographicalName')).toHaveValue('Hoà Bình');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
