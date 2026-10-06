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

/** Same tone, title, body and action label: showing it again restarts the live one. */
function isSame(a: Omit<Toast, 'id'>, b: Omit<Toast, 'id'>): boolean {
  return a.tone === b.tone && a.title === b.title && a.body === b.body && a.action?.label === b.action?.label;
}

export function showToast(toast: Omit<Toast, 'id'>): number {
  const same = toasts.find((t) => isSame(t, toast));
  if (same) {
    // The new caller's action replaces the old one, so the button never runs a stale closure.
    const live: Toast = toast.action ? { ...same, action: toast.action } : same;
    startTimer(live);
    if (live !== same) publish(toasts.map((t) => (t === same ? live : t)));
    return live.id;
  }
  const created: Toast = { ...toast, id: nextId++ };
  // The new toast is always shown: only toasts that were already live make room for it,
  // the oldest that is not an error first, else the oldest of all.
  let kept = toasts;
  while (kept.length >= MAX_TOASTS) {
    const drop = kept.find((t) => t.tone !== 'error') ?? kept[0];
    clearTimer(drop.id);
    kept = kept.filter((t) => t !== drop);
  }
  startTimer(created);
  publish([...kept, created]);
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
