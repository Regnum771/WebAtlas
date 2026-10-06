import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useShell, toggleAssistant } from '../../features/shell/model/shell.store';
import { useSession } from '../../entities/session/model/session.store';
import AuthWidget from '../../features/auth';
import Search from '../../features/search';
import { TopBarView } from './ui/TopBar.view';

export default function TopBar() {
  const { status, currentUser, logout } = useSession();
  const { assistantOpen } = useShell();
  return (
    <header className="top-bar">
      <span className="top-bar-brand">WebATLAS</span>
      <div className="top-bar-search">
        <Search />
      </div>
      <div className="top-bar-right">
        <Link to="/print" className="top-bar-print" title="In / Xuất bản đồ" aria-label="In / Xuất bản đồ">
          <Printer size={18} />
        </Link>
        {status === 'authenticated' && (
          <button type="button" aria-pressed={assistantOpen} onClick={toggleAssistant}>Trợ lý</button>
        )}
        {status === 'authenticated' && currentUser ? (
          <TopBarView email={currentUser.email} role={currentUser.role} onLogout={logout} />
        ) : (
          <AuthWidget />
        )}
      </div>
    </header>
  );
}
