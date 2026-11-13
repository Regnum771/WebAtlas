import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { Role } from '../../../entities/session/model/session.types';
import { ROLE_LABELS } from '../../../entities/session/model/roleLabels';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../shared/ui/shadcn/dropdown-menu';

export interface AccountMenuViewProps {
  /** The account's full name; the email stands in when it has none. */
  name: string | null;
  email: string;
  role: Role;
  /** Shows the Người dùng link into the Quản lý area. */
  canManageUsers: boolean;
  onLogout: () => void;
}

// The Người dùng entry is a UX reveal: the API enforces admin or users.manage on
// every /api/users route regardless of whether this link is rendered.
// Radix closes the menu on Escape and on a press outside, and returns focus to the trigger.
export function AccountMenuView({ name, email, role, canManageUsers, onLogout }: AccountMenuViewProps) {
  const shown = name?.trim() || email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="account-trigger"
        className="inline-flex h-control max-w-60 min-w-0 shrink cursor-pointer items-center gap-1.5 self-center rounded-md border border-transparent px-2 text-body font-semibold text-ink hover:bg-surface-2 data-[state=open]:bg-brand-tint"
      >
        <span className="truncate" title={shown}>{shown}</span>
        <ChevronDown size={16} aria-hidden="true" className="shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-w-72">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-body text-ink" title={email}>{email}</span>
          <span>{ROLE_LABELS[role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/ho-so" className="text-ink no-underline">Hồ sơ</Link>
        </DropdownMenuItem>
        {canManageUsers && (
          <DropdownMenuItem asChild>
            <Link to="/quan-ly/nguoi-dung" className="text-ink no-underline">Người dùng</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>Đăng xuất</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
