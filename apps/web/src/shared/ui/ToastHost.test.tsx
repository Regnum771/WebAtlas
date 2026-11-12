import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast as sonner } from 'sonner';
import { ToastHost } from './ToastHost';
import { showToast, getToasts, resetToasts, MAX_TOASTS } from './toast.store';

beforeEach(() => { resetToasts(); });
afterEach(() => { act(() => { resetToasts(); }); });

describe('ToastHost', () => {
  it('announces a failure as an alert with a close button', async () => {
    render(<ToastHost />);
    act(() => { showToast({ tone: 'error', title: 'Không lưu được', body: 'Thử lại sau.' }); });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-tone', 'error');
    expect(alert).toHaveTextContent('Không lưu được');
    expect(alert).toHaveTextContent('Thử lại sau.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(getToasts()).toHaveLength(0);
  });

  it('gives a warning a close button, since it stays until closed', async () => {
    render(<ToastHost />);
    act(() => { showToast({ tone: 'warning', title: 'Hình nằm ngoài đơn vị chủ quản' }); });
    expect(await screen.findByRole('status')).toHaveTextContent('Hình nằm ngoài đơn vị chủ quản');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(getToasts()).toHaveLength(0);
  });

  it('announces a success as a status', async () => {
    render(<ToastHost />);
    act(() => { showToast({ tone: 'success', title: 'Đã lưu' }); });
    expect(await screen.findByRole('status')).toHaveTextContent('Đã lưu');
    expect(screen.queryByRole('button', { name: 'Đóng thông báo' })).not.toBeInTheDocument();
  });

  it('running an action dismisses the toast', async () => {
    const run = vi.fn();
    render(<ToastHost />);
    act(() => { showToast({ tone: 'error', title: 'Lỗi', action: { label: 'Thử lại', run } }); });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(getToasts()).toHaveLength(0);
  });

  it('Escape with focus inside a toast dismisses it', async () => {
    const user = userEvent.setup();
    render(<ToastHost />);
    act(() => { showToast({ tone: 'error', title: 'Lỗi' }); });
    (await screen.findByRole('button', { name: 'Đóng thông báo' })).focus();
    await user.keyboard('{Escape}');
    expect(getToasts()).toHaveLength(0);
  });

  it('is a polite live region, and each toast keeps its own role', async () => {
    const { container } = render(<ToastHost />);
    const host = container.querySelector('.toast-host') as HTMLElement;
    expect(host).toHaveAttribute('aria-live', 'polite');
    act(() => { showToast({ tone: 'info', title: 'Đã sao chép' }); });
    expect(await screen.findByRole('status')).toHaveTextContent('Đã sao chép');
  });

  it('a toast dismissed inside Sonner leaves the store', async () => {
    render(<ToastHost />);
    let id = 0;
    act(() => { id = showToast({ tone: 'warning', title: 'Còn thiếu đơn vị' }); });
    await screen.findByRole('status');
    // What a swipe or Sonner's own close does: Sonner dismisses it, the store must follow.
    act(() => { sonner.dismiss(id); });
    await waitFor(() => expect(getToasts()).toHaveLength(0));
  });

  it('a toast shown again with a new action runs the new action', async () => {
    const first = vi.fn();
    const second = vi.fn();
    render(<ToastHost />);
    act(() => { showToast({ tone: 'error', title: 'Lỗi', action: { label: 'Thử lại', run: first } }); });
    await screen.findByRole('button', { name: 'Thử lại' });
    act(() => { showToast({ tone: 'error', title: 'Lỗi', action: { label: 'Thử lại', run: second } }); });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('renders at most MAX_TOASTS toasts', async () => {
    const { container } = render(<ToastHost />);
    act(() => {
      for (const title of ['Một', 'Hai', 'Ba', 'Bốn']) showToast({ tone: 'warning', title });
    });
    await waitFor(() => {
      const live = [...container.querySelectorAll('[data-slot="toast"]')].filter((el) => !el.closest('[data-removed="true"]'));
      expect(live).toHaveLength(MAX_TOASTS);
    });
    expect(screen.queryByText('Một')).toBeNull();
  });
});
