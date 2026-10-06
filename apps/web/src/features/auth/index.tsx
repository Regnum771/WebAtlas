import { useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useLoginPresenter } from './model/useLoginPresenter';
import { LoginModalView } from './ui/LoginModal.view';

export default function AuthWidget() {
  const [open, setOpen] = useState(false);
  const presenter = useLoginPresenter(() => setOpen(false));

  return (
    <>
      <Button className="on-green" onClick={() => setOpen(true)}>Đăng nhập</Button>
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
