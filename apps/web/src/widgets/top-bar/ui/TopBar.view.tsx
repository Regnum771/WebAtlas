import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Button } from '../../../shared/ui/Button';
import type { NavItem } from '../model/nav';

export interface TopBarViewProps {
  nav: NavItem[];
  search: ReactNode;
  /** null: no assistant button (a visitor who is not signed in). */
  assistant: { open: boolean; onToggle: () => void } | null;
  /** The sign-in button or the account menu. */
  account: ReactNode;
}

export function TopBarView({ nav, search, assistant, account }: TopBarViewProps) {
  return (
    <header className="top-bar">
      <Link to="/" className="wordmark">WebATLAS</Link>
      <nav aria-label="Điều hướng chính" className="top-nav">
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className="top-nav-link">
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="top-bar-search">{search}</div>
      {assistant && (
        <Button
          className="on-green"
          aria-pressed={assistant.open}
          onClick={assistant.onToggle}
        >
          Trợ lý
        </Button>
      )}
      {account}
    </header>
  );
}
