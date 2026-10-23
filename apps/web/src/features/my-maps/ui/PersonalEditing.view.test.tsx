import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonalEditingView } from './PersonalEditing.view';

const base: ComponentProps<typeof PersonalEditingView> = {
  step: null, drawShape: null, readOnly: false, isNew: false, reshaping: false,
  confirmOpen: false, deleting: false, error: null,
  onLeave: vi.fn(), onReshape: vi.fn(), onAskDelete: vi.fn(), onConfirmDelete: vi.fn(), onCancelDelete: vi.fn(),
};

describe('PersonalEditingView', () => {
  it('shows nothing while no feature is open or drawn', () => {
    const { container } = render(<PersonalEditingView {...base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('while drawing, says what to draw and offers Huỷ', async () => {
    const onLeave = vi.fn();
    render(<PersonalEditingView {...base} step="drawing" drawShape="vùng" onLeave={onLeave} />);
    expect(screen.getByText('Vẽ vùng lên bản đồ để tiếp tục.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onLeave).toHaveBeenCalled();
  });

  it('the form shows Sửa hình and, for a stored feature, Xoá đối tượng', async () => {
    const onAskDelete = vi.fn();
    const onReshape = vi.fn();
    const { rerender } = render(
      <PersonalEditingView {...base} step="form" onAskDelete={onAskDelete} onReshape={onReshape}>
        <p>biểu mẫu</p>
      </PersonalEditingView>,
    );
    expect(screen.getByText('biểu mẫu')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sửa hình' }));
    await user.click(screen.getByRole('button', { name: 'Xoá đối tượng' }));
    expect(onReshape).toHaveBeenCalled();
    expect(onAskDelete).toHaveBeenCalled();
    rerender(<PersonalEditingView {...base} step="form" isNew><p>biểu mẫu</p></PersonalEditingView>);
    expect(screen.queryByRole('button', { name: 'Xoá đối tượng' })).toBeNull();
  });

  it('a recipient sees the form read-only: no buttons', () => {
    render(<PersonalEditingView {...base} step="form" readOnly><p>biểu mẫu</p></PersonalEditingView>);
    expect(screen.getByText('biểu mẫu')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('deleting asks first', async () => {
    const onConfirmDelete = vi.fn();
    render(<PersonalEditingView {...base} step="form" confirmOpen onConfirmDelete={onConfirmDelete} />);
    const dialog = screen.getByRole('dialog', { name: 'Xoá đối tượng này?' });
    expect(dialog).toHaveTextContent('Không khôi phục được.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Xoá' }));
    expect(onConfirmDelete).toHaveBeenCalled();
  });

  it('Sửa đối tượng no longer exists', () => {
    render(<PersonalEditingView {...base} step="form"><p>biểu mẫu</p></PersonalEditingView>);
    expect(screen.queryByText('Sửa đối tượng')).toBeNull();
    expect(screen.queryByText('Bấm một đối tượng của bản đồ này để sửa.')).toBeNull();
  });
});
