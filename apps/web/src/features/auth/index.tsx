import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useSession } from '../../entities/session/model/session.store';
import { useLoginPresenter } from './model/useLoginPresenter';
import { LoginModalView } from './ui/LoginModal.view';
import { UserBadgeView } from './ui/UserBadge.view';

export default function AuthWidget() {
  const { status, currentUser, logout } = useSession();
  const [open, setOpen] = useState(false);
  const presenter = useLoginPresenter(() => setOpen(false));

  if (status === 'authenticated' && currentUser) {
    return <UserBadgeView email={currentUser.email} onLogout={logout} />;
  }

  return (
    <>
      <button type="button" className="admin-login-btn glass-panel" onClick={() => setOpen(true)}>
        <LogIn size={16} />
        <span>Admin login</span>
      </button>
      <LoginModalView
        open={open}
        email={presenter.email}
        password={presenter.password}
        loading={presenter.loading}
        error={presenter.error}
        onEmail={presenter.setEmail}
        onPassword={presenter.setPassword}
        onSubmit={presenter.submit}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
