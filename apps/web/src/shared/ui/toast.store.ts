import { useSyncExternalStore } from 'react';

export type ToastTone = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

export const TOAST_AUTO_CLOSE_MS = 6000;
export const MAX_TOASTS = 3;

/** Popups ("toasts"). A module store, like roi.store.ts, so any code can raise one. */
let toasts: Toast[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
function publish(next: Toast[]) { toasts = next; for (const l of listeners) l(); }

function clearTimer(id: number) {
  const t = timers.get(id);
  if (t !== undefined) { clearTimeout(t); timers.delete(id); }
}
function startTimer(toast: Toast) {
  clearTimer(toast.id);
  if (toast.tone === 'error') return;
  timers.set(toast.id, setTimeout(() => dismissToast(toast.id), TOAST_AUTO_CLOSE_MS));
}

export function showToast(toast: Omit<Toast, 'id'>): number {
  const same = toasts.find((t) => t.tone === toast.tone && t.title === toast.title && t.body === toast.body);
  if (same) { startTimer(same); return same.id; }
  const created: Toast = { ...toast, id: nextId++ };
  let next = [...toasts, created];
  while (next.length > MAX_TOASTS) {
    const drop = next.find((t) => t.tone !== 'error') ?? next[0];
    clearTimer(drop.id);
    next = next.filter((t) => t !== drop);
  }
  startTimer(created);
  publish(next);
  return created.id;
}

export function dismissToast(id: number): void {
  clearTimer(id);
  if (toasts.some((t) => t.id === id)) publish(toasts.filter((t) => t.id !== id));
}

export function getToasts(): Toast[] { return toasts; }

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useToasts(): Toast[] { return useSyncExternalStore(subscribe, getToasts); }

/** Tests only. */
export function resetToasts(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  publish([]);
}
