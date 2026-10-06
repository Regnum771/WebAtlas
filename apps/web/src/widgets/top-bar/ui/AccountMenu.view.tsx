import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { Role } from '../../../entities/session/model/session.types';
import { ROLE_LABELS } from '../../../entities/session/model/roleLabels';

export interface AccountMenuViewProps {
  email: string;
  role: Role;
  onLogout: () => void;
}

// The admin entry is a UX reveal: the API enforces admin on every /api/users
// route regardless of whether this link is rendered.
export function AccountMenuView({ email, role, onLogout }: AccountMenuViewProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onPress = (e: MouseEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      setOpen(false);
      // The press has not moved focus yet. Once it has, take focus back only if it
      // was left on nothing, so a click on another control keeps what it focused.
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body) trigger.current?.focus();
      }, 0);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPress);
    };
  }, [open]);

  return (
    <div className="account" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {ROLE_LABELS[role]}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="account-menu float">
          <span className="account-email" title={email}>{email}</span>
          {role === 'admin' && (
            <Link to="/admin/users" role="menuitem" className="account-item" onClick={() => setOpen(false)}>
              Người dùng
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            className="account-item"
            onClick={() => { setOpen(false); onLogout(); }}
          >
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}
