import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonalEditingView } from './PersonalEditing.view';

const base: ComponentProps<typeof PersonalEditingView> = {
  active: false, kind: null, step: null, layers: [], drawShape: null, isNew: false, reshaping: false,
  confirmOpen: false, deleting: false, error: null,
  onDraw: vi.fn(), onEdit: vi.fn(), onPick: vi.fn(), onLeave: vi.fn(), onReshape: vi.fn(), onAskDelete: vi.fn(),
  onConfirmDelete: vi.fn(), onCancelDelete: vi.fn(),
};

describe('PersonalEditingView', () => {
  it('offers Vẽ thêm and Sửa đối tượng while no mode is on', async () => {
    const onDraw = vi.fn();
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<PersonalEditingView {...base} onDraw={onDraw} onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: 'Vẽ thêm' }));
    await user.click(screen.getByRole('button', { name: 'Sửa đối tượng' }));
    expect(onDraw).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalled();
  });

  it('Vẽ thêm lists the layers to draw into', async () => {
    const onPick = vi.fn();
    render(<PersonalEditingView {...base} active kind="draw" step="pick"
      layers={[{ id: 'l1', title: 'Điểm ngập' }, { id: 'c1', title: 'Sửa lớp Đập' }]} onPick={onPick} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sửa lớp Đập' }));
    expect(onPick).toHaveBeenCalledWith('c1');
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
  });

  it('Sửa đối tượng shows its hint', () => {
    render(<PersonalEditingView {...base} active kind="edit" step="select" />);
    expect(screen.getByText('Bấm một đối tượng của bản đồ này để sửa.')).toBeInTheDocument();
  });

  it('the form step shows the form with Sửa hình and, for a stored feature, Xoá đối tượng', async () => {
    const onAskDelete = vi.fn();
    const onReshape = vi.fn();
    const { rerender } = render(
      <PersonalEditingView {...base} active kind="edit" step="form" onAskDelete={onAskDelete} onReshape={onReshape}>
        <p>biểu mẫu</p>
      </PersonalEditingView>,
    );
    expect(screen.getByText('biểu mẫu')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sửa hình' }));
    await user.click(screen.getByRole('button', { name: 'Xoá đối tượng' }));
    expect(onReshape).toHaveBeenCalled();
    expect(onAskDelete).toHaveBeenCalled();
    rerender(<PersonalEditingView {...base} active kind="draw" step="form" isNew><p>biểu mẫu</p></PersonalEditingView>);
    expect(screen.queryByRole('button', { name: 'Xoá đối tượng' })).toBeNull();
  });

  it('deleting asks first', async () => {
    const onConfirmDelete = vi.fn();
    render(<PersonalEditingView {...base} active kind="edit" step="form" confirmOpen onConfirmDelete={onConfirmDelete} />);
    const dialog = screen.getByRole('dialog', { name: 'Xoá đối tượng này?' });
    expect(dialog).toHaveTextContent('Không khôi phục được.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Xoá' }));
    expect(onConfirmDelete).toHaveBeenCalled();
  });
});
