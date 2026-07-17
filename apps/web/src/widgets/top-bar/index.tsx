import { useSession } from '../../entities/session/model/session.store';
import AuthWidget from '../../features/auth';
import { TopBarView } from './ui/TopBar.view';

export default function TopBar() {
  const { status, currentUser, logout } = useSession();
  return (
    <header className="top-bar glass-panel">
      <span className="top-bar-brand">WebATLAS</span>
      <div className="top-bar-right">
        {status === 'authenticated' && currentUser ? (
          <TopBarView email={currentUser.email} role={currentUser.role} onLogout={logout} />
        ) : (
          <AuthWidget />
        )}
      </div>
    </header>
  );
}
