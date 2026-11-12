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

  it('keeps a warning toast until it is dismissed', () => {
    const id = showToast({ tone: 'warning', title: 'Hình nằm ngoài đơn vị chủ quản' });
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

  it('shows a new toast even when the three live toasts are all errors', () => {
    for (const n of [1, 2, 3]) showToast({ tone: 'error', title: `Lỗi ${n}` });
    const info = showToast({ tone: 'info', title: 'Tin 1' });
    expect(getToasts().map((t) => t.title)).toEqual(['Lỗi 2', 'Lỗi 3', 'Tin 1']);
    expect(getToasts().some((t) => t.id === info)).toBe(true);
    act(() => { vi.advanceTimersByTime(TOAST_AUTO_CLOSE_MS); });
    expect(getToasts().map((t) => t.title)).toEqual(['Lỗi 2', 'Lỗi 3']);
  });

  it('clears the timer of the toast it drops', () => {
    for (const n of [1, 2, 3]) showToast({ tone: 'info', title: `Tin ${n}` });
    expect(vi.getTimerCount()).toBe(3);
    showToast({ tone: 'success', title: 'Xong 1' });
    expect(getToasts().map((t) => t.title)).toEqual(['Tin 2', 'Tin 3', 'Xong 1']);
    expect(vi.getTimerCount()).toBe(3);
  });

  it('treats a toast with a different action label as a new toast', () => {
    const a = showToast({ tone: 'error', title: 'Lỗi', action: { label: 'Thử lại', run: vi.fn() } });
    const b = showToast({ tone: 'error', title: 'Lỗi', action: { label: 'Mở lại', run: vi.fn() } });
    const c = showToast({ tone: 'error', title: 'Lỗi' });
    expect(new Set([a, b, c]).size).toBe(3);
    expect(getToasts()).toHaveLength(3);
  });

  it('gives a live toast the action of the same toast shown again', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = showToast({ tone: 'error', title: 'Lỗi', action: { label: 'Thử lại', run: first } });
    const b = showToast({ tone: 'error', title: 'Lỗi', action: { label: 'Thử lại', run: second } });
    expect(b).toBe(a);
    expect(getToasts()).toHaveLength(1);
    getToasts()[0].action?.run();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('resetToasts clears every pending timer', () => {
    showToast({ tone: 'info', title: 'a' });
    showToast({ tone: 'success', title: 'b' });
    expect(vi.getTimerCount()).toBe(2);
    resetToasts();
    expect(vi.getTimerCount()).toBe(0);
  });
});
