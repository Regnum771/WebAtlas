import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import type { NavEntry } from '../model/nav';

export interface TopBarViewProps {
  nav: NavEntry[];
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
        {nav.map((item) => item.kind === 'route' ? (
          <NavLink key={item.to} to={item.to} className="top-nav-link">
            {item.label}
          </NavLink>
        ) : (
          // Another service of the platform: a new tab, so the map keeps its state here.
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className={item.down ? 'top-nav-link is-down' : 'top-nav-link'}
            title={item.down ? `${item.label}: không kết nối được` : undefined}
          >
            {item.label}
            <ArrowUpRight size={14} aria-label="(mở thẻ mới)" />
          </a>
        ))}
      </nav>
      <div className="top-bar-search">{search}</div>
      {assistant && (
        <Button
          variant="inverse"
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
