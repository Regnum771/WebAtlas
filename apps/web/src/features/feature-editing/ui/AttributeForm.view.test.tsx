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

  it('read-only: inputs disabled, no buttons', () => {
    render(<AttributeFormView {...baseProps} values={{ name: 'Hoà Bình', status: '' }} readOnly />);
    expect(screen.getByLabelText('geographicalName')).toBeDisabled();
    expect(screen.getByLabelText('geographicalName')).toHaveValue('Hoà Bình');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
