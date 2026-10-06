import type { ReactNode } from 'react';
import { Check, CircleAlert, Info, TriangleAlert } from 'lucide-react';

export type MessageTone = 'info' | 'caution' | 'success' | 'error';

const ICONS = { info: Info, caution: TriangleAlert, success: Check, error: CircleAlert } as const;

/** An error is role="alert" and the only red tone; the rest are role="status" and ink. */
export function Message({
  tone = 'info',
  title,
  children,
  actions,
}: {
  tone?: MessageTone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = ICONS[tone];
  const isError = tone === 'error';
  return (
    <div className={isError ? 'msg bad' : 'msg'} role={isError ? 'alert' : 'status'}>
      <Icon size={16} aria-hidden="true" />
      <div>
        <b>{title}</b>
        {children ? <p>{children}</p> : null}
        {actions ? <div className="acts">{actions}</div> : null}
      </div>
    </div>
  );
}
