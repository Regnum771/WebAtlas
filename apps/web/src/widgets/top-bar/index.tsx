import { useShell, toggleAssistant } from '../../features/shell/model/shell.store';
import { useSession } from '../../entities/session/model/session.store';
import AuthWidget from '../../features/auth';
import Search from '../../features/search';
import { TopBarView } from './ui/TopBar.view';
import { AccountMenuView } from './ui/AccountMenu.view';
import { useCan } from '../../entities/session/model/useCan';
import { canSeeUsers } from '../../pages/quan-ly/model/visibility';
import { navFor } from './model/nav';

export default function TopBar() {
  const { status, currentUser, logout } = useSession();
  const { assistantOpen } = useShell();
  const can = useCan();
  const user = status === 'authenticated' ? currentUser : null;
  return (
    <TopBarView
      nav={navFor(user, can)}
      search={<Search />}
      assistant={user ? { open: assistantOpen, onToggle: toggleAssistant } : null}
      account={user ? <AccountMenuView email={user.email} role={user.role} canManageUsers={canSeeUsers(user, can)} onLogout={logout} /> : <AuthWidget />}
    />
  );
}
