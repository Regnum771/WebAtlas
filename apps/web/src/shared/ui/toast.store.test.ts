import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { showToast, dismissToast, getToasts, resetToasts, TOAST_AUTO_CLOSE_MS } from './toast.store';

beforeEach(() => { vi.useFakeTimers(); resetToasts(); });
afterEach(() => { resetToasts(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });

describe('toast store', () => {
  it('closes an info toast by itself after 6 s', () => {
    showToast({ tone: 'info', title: 'Đã sao chép' });
    act(() => { vi.advanceTimersByTime(TOAST_AUTO_CLOSE_MS - 1); });
    expect(getToasts()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(getToasts()).toHaveLength(0);
  });

  it('closes a success toast by itself', () => {
    showToast({ tone: 'success', title: 'Đã lưu' });
    act(() => { vi.advanceTimersByTime(TOAST_AUTO_CLOSE_MS); });
    expect(getToasts()).toHaveLength(0);
  });

  it('keeps an error toast until it is dismissed', () => {
    const id = showToast({ tone: 'error', title: 'Không lưu được' });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(getToasts()).toHaveLength(1);
    dismissToast(id);
    expect(getToasts()).toHaveLength(0);
  });

  it('does not stack the same failure twice', () => {
    const a = showToast({ tone: 'error', title: 'Không lưu được thay đổi', body: 'Máy chủ không phản hồi.' });
    const b = showToast({ tone: 'error', title: 'Không lưu được thay đổi', body: 'Máy chủ không phản hồi.' });
    expect(b).toBe(a);
    expect(getToasts()).toHaveLength(1);
  });

  it('restarts the timer when the same toast is shown again', () => {
    const a = showToast({ tone: 'info', title: 'Đã sao chép' });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(showToast({ tone: 'info', title: 'Đã sao chép' })).toBe(a);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(getToasts()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(getToasts()).toHaveLength(0);
  });

  it('shows at most three, dropping the oldest that is not an error', () => {
    showToast({ tone: 'error', title: 'Lỗi 1' });
    const info = showToast({ tone: 'info', title: 'Tin 1' });
    showToast({ tone: 'success', title: 'Xong 1' });
    showToast({ tone: 'info', title: 'Tin 2' });
    const titles = getToasts().map((t) => t.title);
    expect(titles).toEqual(['Lỗi 1', 'Xong 1', 'Tin 2']);
    expect(getToasts().some((t) => t.id === info)).toBe(false);
  });

  it('drops the oldest of all when every toast is an error', () => {
    for (const n of [1, 2, 3, 4]) showToast({ tone: 'error', title: `Lỗi ${n}` });
    expect(getToasts().map((t) => t.title)).toEqual(['Lỗi 2', 'Lỗi 3', 'Lỗi 4']);
  });

  it('resetToasts clears every pending timer', () => {
    showToast({ tone: 'info', title: 'a' });
    showToast({ tone: 'success', title: 'b' });
    expect(vi.getTimerCount()).toBe(2);
    resetToasts();
    expect(vi.getTimerCount()).toBe(0);
  });
});
