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

  it('marks its variant and size, outline and md by default', () => {
    render(<Button>Ok</Button>);
    const b = screen.getByRole('button');
    expect(b).toHaveAttribute('data-slot', 'button');
    expect(b).toHaveAttribute('data-variant', 'outline');
    expect(b).toHaveAttribute('data-size', 'md');
  });

  it('a danger button says so', () => {
    render(<Button variant="danger">Xoá</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'danger');
  });

  it('an inverse toggle on the green bar stays pressable while pressed', async () => {
    const onClick = vi.fn();
    render(<Button variant="inverse" aria-pressed="true" onClick={onClick}>Lớp</Button>);
    const b = screen.getByRole('button', { name: 'Lớp', pressed: true });
    expect(b).toHaveAttribute('data-variant', 'inverse');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
