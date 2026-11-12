import { useEffect, useRef, type CSSProperties } from 'react';
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
        'flex items-center gap-3.5 rounded-lg border border-line bg-surface px-3.5 py-2 font-ui text-body text-ink shadow-pop',
        TONE[toast.tone],
      )}
      data-slot="toast"
      data-tone={toast.tone}
      role={bad ? 'alert' : 'status'}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); dismissToast(toast.id); } }}
      // Sonner's list remembers what had focus before it and focuses that again when focus
      // leaves the list, which would throw Tab back past the toast. Its buttons are ordinary
      // tab stops, so Sonner never hears about focus inside a toast.
      onFocus={(e) => e.stopPropagation()}
      onBlur={(e) => e.stopPropagation()}
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
 * Sonner sizes toasts it styles itself; ours are custom, so each item is centred in the list
 * and only as wide as its text, up to the list's width.
 */
const ITEM_STYLE: CSSProperties = { left: 0, right: 0, marginInline: 'auto', width: 'fit-content', maxWidth: '100%' };

/** Of the band (.toast-host spans the map stage less 12 px each side), so a toast never leaves the map. */
const LIST_WIDTH = 'min(560px, 100%)';

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
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    for (const t of toasts) {
      if (shown.current.get(t.id) === t) continue;
      shown.current.set(t.id, t);
      sonner.custom(() => <ToastItem toast={t} />, { id: t.id, duration: Infinity, style: ITEM_STYLE, onDismiss: () => dismissToast(t.id) });
    }
    for (const id of [...shown.current.keys()]) {
      if (live.has(id)) continue;
      shown.current.delete(id);
      sonner.dismiss(id);
    }
  }, [toasts]);

  // Sonner makes every toast's <li> a tab stop (tabIndex 0) with its own focus ring, which
  // would add an empty stop before the toast's buttons and override the R9 ring. Take each
  // one out of the tab order as Sonner adds it.
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const untab = () => root.querySelectorAll('[data-sonner-toast][tabindex="0"]').forEach((li) => li.setAttribute('tabindex', '-1'));
    const observer = new MutationObserver(untab);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex'] });
    untab();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const current = shown.current;
    return () => {
      for (const id of current.keys()) sonner.dismiss(id);
      current.clear();
    };
  }, []);

  return (
    <div ref={host} className="toast-host" aria-live="polite">
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
        style={{ position: 'absolute', zIndex: 'auto', '--width': LIST_WIDTH } as CSSProperties}
      />
    </div>
  );
}
