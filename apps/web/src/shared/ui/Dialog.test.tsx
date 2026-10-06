import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from './Dialog';

function Host({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Mở</button>
      <Dialog open={open} title="Đăng nhập" onClose={() => { onClose(); setOpen(false); }}>
        <input aria-label="Email" />
        <button type="button">Gửi</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('moves focus inside on open and back to the opener on close', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Mở' });
    await user.click(opener);
    expect(screen.getByLabelText('Email')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('Escape closes it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Mở' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape does not reach a keydown listener on document', async () => {
    const user = userEvent.setup();
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    try {
      render(<Host />);
      await user.click(screen.getByRole('button', { name: 'Mở' }));
      await user.keyboard('{Escape}');
      expect(behind).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', behind);
    }
  });

  it('a click on the backdrop closes it, a click inside does not', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Mở' }));
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with two dialogs open, Escape closes only the one opened last', async () => {
    const user = userEvent.setup();
    function Stack() {
      const [a, setA] = useState(false);
      const [b, setB] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setA(true)}>Mở A</button>
          <Dialog open={a} title="A" onClose={() => setA(false)}>
            <button type="button" onClick={() => setB(true)}>Mở B</button>
          </Dialog>
          <Dialog open={b} title="B" onClose={() => setB(false)}>
            <button type="button">Trong B</button>
          </Dialog>
        </>
      );
    }
    render(<Stack />);
    await user.click(screen.getByRole('button', { name: 'Mở A' }));
    const openB = screen.getByRole('button', { name: 'Mở B' });
    await user.click(openB);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'B' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'A' })).toBeInTheDocument();
    expect(openB).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở A' })).toHaveFocus();
  });

  it('is labelled by its title', () => {
    render(<Dialog open title="Đăng nhập" onClose={() => {}}><p>x</p></Dialog>);
    expect(screen.getByRole('dialog', { name: 'Đăng nhập' })).toBeInTheDocument();
  });
});
