import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

const base = { open: true, title: 'Xoá đối tượng', message: 'Không hoàn tác được.', onConfirm: () => {}, onCancel: () => {} };

describe('ConfirmDialog', () => {
  it('a reversible confirm button is not red', () => {
    render(<ConfirmDialog {...base} confirmLabel="Lưu" />);
    expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveClass('danger');
  });

  it('an irreversible confirm button is red and repeats the verb', () => {
    render(<ConfirmDialog {...base} confirmLabel="Xoá" irreversible />);
    expect(screen.getByRole('button', { name: 'Xoá' })).toHaveClass('danger');
  });

  it('offers Huỷ, first in the DOM', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} confirmLabel="Xoá" onCancel={onCancel} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Huỷ');
    await userEvent.setup().click(buttons[0]);
    expect(onCancel).toHaveBeenCalled();
  });

  it('while busy the confirm button keeps its label and ignores presses', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base} confirmLabel="Xoá" busy onConfirm={onConfirm} />);
    const confirm = screen.getByRole('button', { name: 'Xoá' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await userEvent.setup().click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
