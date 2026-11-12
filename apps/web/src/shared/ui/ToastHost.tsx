import { useEffect, useRef } from 'react';
import { Check, CircleAlert, TriangleAlert, X } from 'lucide-react';
import { Toaster, toast as sonner } from 'sonner';
import { cn } from '../lib/utils';
import { Button } from './Button';
import { dismissToast, isSticky, MAX_TOASTS, useToasts, type Toast } from './toast.store';

const TONE = {
  info: '',
  success: '',
  warning: 'border-notice-line',
  error: 'border-2 border-alert',
} as const;

function ToastItem({ toast }: { toast: Toast }) {
  const bad = toast.tone === 'error';
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-lg border border-line bg-surface px-3.5 py-2 text-body text-ink shadow-pop',
        TONE[toast.tone],
      )}
      data-slot="toast"
      data-tone={toast.tone}
      role={bad ? 'alert' : 'status'}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); dismissToast(toast.id); } }}
    >
      {toast.tone === 'success' && <Check size={16} className="shrink-0 text-ok" aria-hidden="true" />}
      {toast.tone === 'warning' && <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />}
      {bad && <CircleAlert size={16} className="shrink-0 text-alert" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <b>{toast.title}</b>
        {toast.body ? ` ${toast.body}` : null}
      </div>
      {toast.action && (
        <Button size="sm" onClick={() => { toast.action?.run(); dismissToast(toast.id); }}>{toast.action.label}</Button>
      )}
      {isSticky(toast.tone) && (
        <Button size="sm" aria-label="Đóng thông báo" onClick={() => dismissToast(toast.id)}>
          <X size={14} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/**
 * Renders the popup store through Sonner. The store keeps the policy (dedupe, MAX_TOASTS,
 * which tones stay until closed, the auto-close timer); Sonner only draws and animates, so
 * every toast is shown with no timer of its own, and a toast Sonner dismisses (a swipe)
 * leaves the store too. Placement is the shell's job: `.toast-host` is the band.
 */
export function ToastHost() {
  const toasts = useToasts();
  /** What Sonner currently shows, by id; an entry is replaced when the store replaces a toast. */
  const shown = useRef(new Map<number, Toast>());

  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    for (const t of toasts) {
      if (shown.current.get(t.id) === t) continue;
      shown.current.set(t.id, t);
      sonner.custom(() => <ToastItem toast={t} />, { id: t.id, duration: Infinity, onDismiss: () => dismissToast(t.id) });
    }
    for (const id of [...shown.current.keys()]) {
      if (live.has(id)) continue;
      shown.current.delete(id);
      sonner.dismiss(id);
    }
  }, [toasts]);

  useEffect(() => {
    const current = shown.current;
    return () => {
      for (const id of current.keys()) sonner.dismiss(id);
      current.clear();
    };
  }, []);

  return (
    <div className="toast-host" aria-live="polite">
      <Toaster
        theme="light"
        position="bottom-center"
        expand
        visibleToasts={MAX_TOASTS}
        gap={8}
        offset={0}
        hotkey={[]}
        // No name: a named <section> is a region landmark, and the app had none here. The
        // .toast-host live region announces the toasts.
        customAriaLabel=""
        // Sonner injects an unlayered stylesheet (position: fixed; z-index: 999999999) that
        // beats every cascade layer; only inline style can put the list back in the band,
        // under dialogs.
        style={{ position: 'absolute', zIndex: 'auto' }}
      />
    </div>
  );
}
