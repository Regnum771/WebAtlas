import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupFormView } from './GroupForm.view';

const base = {
  open: true, mode: 'create' as const,
  values: { name: '', description: '', units: [], permissions: [] },
  template: null, fieldErrors: {}, formError: null, canSave: true, saving: false,
  picker: <div>PICKER</div>,
  onTemplate: vi.fn(), onField: vi.fn(), onTogglePermission: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn(),
};

describe('GroupFormView', () => {
  it('offers the three templates and Trống on create, not on edit', () => {
    const { rerender } = render(<GroupFormView {...base} />);
    for (const n of ['Cán bộ cấp Bộ', 'Cán bộ cấp tỉnh', 'Cán bộ cấp xã', 'Trống']) {
      expect(screen.getByRole('radio', { name: n })).toBeInTheDocument();
    }
    rerender(<GroupFormView {...base} mode="edit" />);
    expect(screen.queryByRole('radio', { name: 'Trống' })).toBeNull();
  });

  it('choosing a template and ticking a permission call back', async () => {
    const onTemplate = vi.fn();
    const onTogglePermission = vi.fn();
    const user = userEvent.setup();
    render(<GroupFormView {...base} onTemplate={onTemplate} onTogglePermission={onTogglePermission} />);
    await user.click(screen.getByRole('radio', { name: 'Cán bộ cấp tỉnh' }));
    expect(onTemplate).toHaveBeenCalledWith('tinh');
    await user.click(screen.getByRole('checkbox', { name: 'duyệt và xuất bản' }));
    expect(onTogglePermission).toHaveBeenCalledWith('submission.review');
  });

  it('shows the name field error and submits with Lưu', async () => {
    const onSubmit = vi.fn();
    render(<GroupFormView {...base} fieldErrors={{ name: 'Đã có nhóm tên này.' }} onSubmit={onSubmit} />);
    expect(screen.getByText('Đã có nhóm tên này.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lưu' }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
