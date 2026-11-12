import { Check, CircleAlert, TriangleAlert, X } from 'lucide-react';
import { Button } from './Button';
import { dismissToast, isSticky, useToasts, type Toast } from './toast.store';

function ToastItem({ toast }: { toast: Toast }) {
  const bad = toast.tone === 'error';
  return (
    <div
      className={bad ? 'toast bad' : 'toast'}
      role={bad ? 'alert' : 'status'}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); dismissToast(toast.id); } }}
    >
      {toast.tone === 'success' && <Check size={16} aria-hidden="true" />}
      {toast.tone === 'warning' && <TriangleAlert size={16} aria-hidden="true" />}
      {bad && <CircleAlert size={16} aria-hidden="true" />}
      <div>
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

/** Renders the popup store. Placement is the shell's job. */
export function ToastHost() {
  const toasts = useToasts();
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
}
