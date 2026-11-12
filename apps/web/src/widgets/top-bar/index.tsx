import { useShell, toggleAssistant } from '../../features/shell/model/shell.store';
import { useSession } from '../../entities/session/model/session.store';
import AuthWidget from '../../features/auth';
import Search from '../../features/search';
import { TopBarView } from './ui/TopBar.view';
import { AccountMenuView } from './ui/AccountMenu.view';
import { useCan } from '../../entities/session/model/useCan';
import { usePlatformServices } from '../../entities/platform/model/platformServices.store';
import { canSeeUsers } from '../../pages/quan-ly/model/visibility';
import { navFor, resolveNav } from './model/nav';

export default function TopBar() {
  const { status, currentUser, logout } = useSession();
  const { assistantOpen } = useShell();
  const { services } = usePlatformServices();
  const can = useCan();
  const user = status === 'authenticated' ? currentUser : null;
  return (
    <TopBarView
      nav={resolveNav(navFor(user, can), services)}
      search={<Search />}
      assistant={user ? { open: assistantOpen, onToggle: toggleAssistant } : null}
      account={user ? <AccountMenuView name={user.full_name} email={user.email} role={user.role} canManageUsers={canSeeUsers(user, can)} onLogout={logout} /> : <AuthWidget />}
    />
  );
}
