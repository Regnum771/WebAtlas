import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

const base = { open: true, title: 'Xoá đối tượng', message: 'Không hoàn tác được.', onConfirm: () => {}, onCancel: () => {} };

describe('ConfirmDialog', () => {
  it('a reversible confirm button is not red', () => {
    render(<ConfirmDialog {...base} confirmLabel="Lưu" />);
    expect(screen.getByRole('button', { name: 'Lưu' })).toHaveAttribute('data-variant', 'solid');
  });

  it('an irreversible confirm button is red and repeats the verb', () => {
    render(<ConfirmDialog {...base} confirmLabel="Xoá" irreversible />);
    expect(screen.getByRole('button', { name: 'Xoá' })).toHaveAttribute('data-variant', 'danger');
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

  it('is an alert dialog labelled by its title', () => {
    render(<ConfirmDialog {...base} confirmLabel="Xoá" />);
    expect(screen.getByRole('alertdialog', { name: 'Xoá đối tượng' })).toBeInTheDocument();
  });

  it('a press outside does not cancel it', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} confirmLabel="Xoá" onCancel={onCancel} />);
    await userEvent.setup().click(screen.getByRole('alertdialog').parentElement as HTMLElement);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('Escape cancels it', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} confirmLabel="Xoá" onCancel={onCancel} />);
    await userEvent.setup().keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('gives focus back to the button that opened it when cancelled', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Xoá lớp</button>
          <ConfirmDialog {...base} open={open} confirmLabel="Xoá" onCancel={() => setOpen(false)} />
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Xoá lớp' });
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Huỷ' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
