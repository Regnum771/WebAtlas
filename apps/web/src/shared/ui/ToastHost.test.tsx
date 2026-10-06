import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastHost } from './ToastHost';
import { showToast, getToasts, resetToasts } from './toast.store';

beforeEach(() => { resetToasts(); });
afterEach(() => { act(() => { resetToasts(); }); });

describe('ToastHost', () => {
  it('announces a failure as an alert with a close button', async () => {
    render(<ToastHost />);
    act(() => { showToast({ tone: 'error', title: 'Không lưu được', body: 'Thử lại sau.' }); });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bad');
    expect(alert).toHaveTextContent('Không lưu được');
    expect(alert).toHaveTextContent('Thử lại sau.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(getToasts()).toHaveLength(0);
  });

  it('announces a success as a status', () => {
    render(<ToastHost />);
    act(() => { showToast({ tone: 'success', title: 'Đã lưu' }); });
    expect(screen.getByRole('status')).toHaveTextContent('Đã lưu');
    expect(screen.queryByRole('button', { name: 'Đóng thông báo' })).not.toBeInTheDocument();
  });

  it('running an action dismisses the toast', async () => {
    const run = vi.fn();
    render(<ToastHost />);
    act(() => { showToast({ tone: 'error', title: 'Lỗi', action: { label: 'Thử lại', run } }); });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(getToasts()).toHaveLength(0);
  });

  it('Escape with focus inside a toast dismisses it', async () => {
    const user = userEvent.setup();
    render(<ToastHost />);
    act(() => { showToast({ tone: 'error', title: 'Lỗi' }); });
    screen.getByRole('button', { name: 'Đóng thông báo' }).focus();
    await user.keyboard('{Escape}');
    expect(getToasts()).toHaveLength(0);
  });
});
