import { useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { startSsoLogin } from '../../entities/session/api/session.api';
import { useAuthConfig } from '../../entities/session/model/useAuthConfig';
import { useLoginPresenter } from './model/useLoginPresenter';
import { LoginModalView } from './ui/LoginModal.view';

export default function AuthWidget() {
  const [open, setOpen] = useState(false);
  const presenter = useLoginPresenter(() => close());
  // Without an answer (API down, or no SSO configured) the dialog offers the password form only.
  const sso = useAuthConfig()?.sso ?? null;

  // However the dialog closes (Escape, backdrop, a successful sign-in), the typed
  // password and the form error go with it; the email stays for the next attempt.
  function close() {
    setOpen(false);
    presenter.clearSecret();
  }

  return (
    <>
      <Button variant="inverse" onClick={() => setOpen(true)}>Đăng nhập</Button>
      <LoginModalView
        open={open}
        values={presenter.values}
        errors={presenter.errors}
        formError={presenter.formError}
        loading={presenter.loading}
        onField={presenter.set}
        onBlur={presenter.blur}
        onSubmit={presenter.submit}
        onClose={close}
        onSso={sso ? () => startSsoLogin(sso.loginPath, window.location.pathname + window.location.search) : undefined}
      />
    </>
  );
}
