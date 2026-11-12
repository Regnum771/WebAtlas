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

// A nav item fills the header's height so its 2 px underline sits on the header's bottom border.
const NAV_LINK =
  'inline-flex items-center gap-0.5 border-b-2 border-transparent pt-0.5 text-body font-medium text-ink-2 no-underline whitespace-nowrap hover:text-ink aria-[current=page]:border-brand aria-[current=page]:font-semibold aria-[current=page]:text-ink';

/** The 44 px header of every screen (spec "Surfaces → Map → Header"). */
export function TopBarView({ nav, search, assistant, account }: TopBarViewProps) {
  return (
    <header
      data-slot="app-header"
      className="relative z-[100] col-span-full flex h-header items-stretch gap-5 border-b border-line bg-surface px-4 text-ink"
    >
      <Link to="/" className="self-center text-[16px] font-bold whitespace-nowrap text-brand no-underline">
        WebATLAS
      </Link>
      <nav aria-label="Điều hướng chính" className="flex items-stretch gap-4">
        {nav.map((item) => item.kind === 'route' ? (
          <NavLink key={item.to} to={item.to} className={NAV_LINK}>
            {item.label}
          </NavLink>
        ) : (
          // Another service of the platform: a new tab, so the map keeps its state here.
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            data-down={item.down || undefined}
            className={`${NAV_LINK} data-[down]:line-through data-[down]:opacity-60`}
            title={item.down ? `${item.label}: không kết nối được` : undefined}
          >
            {item.label}
            <ArrowUpRight size={14} aria-label="(mở thẻ mới)" />
          </a>
        ))}
      </nav>
      <div className="ml-auto flex w-[270px] min-w-0 shrink items-center">{search}</div>
      {assistant && (
        <Button
          className="self-center aria-pressed:border-brand-line aria-pressed:bg-brand-tint aria-pressed:text-brand"
          aria-pressed={assistant.open}
          onClick={assistant.onToggle}
        >
          Trợ lý
        </Button>
      )}
      <div className="flex min-w-0 items-center">{account}</div>
    </header>
  );
}
