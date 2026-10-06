import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('a busy button shows its busy label, is aria-busy, and ignores a press', async () => {
    const onClick = vi.fn();
    render(
      <Button busy busyLabel="Đang đăng nhập" onClick={onClick}>
        Đăng nhập
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Đang đăng nhập' });
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(b).toHaveAttribute('aria-disabled', 'true');
    expect(b).not.toBeDisabled();
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a busy submit button does not submit its form', async () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" busy>
          Gửi
        </Button>
      </form>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('an idle submit button submits its form and calls onClick', async () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const onClick = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" onClick={onClick}>
          Gửi
        </Button>
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('defaults to type="button"', () => {
    render(<Button>Ok</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});
