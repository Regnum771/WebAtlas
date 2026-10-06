import { useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useLoginPresenter } from './model/useLoginPresenter';
import { LoginModalView } from './ui/LoginModal.view';

export default function AuthWidget() {
  const [open, setOpen] = useState(false);
  const presenter = useLoginPresenter(() => close());

  // However the dialog closes (Escape, backdrop, a successful sign-in), the typed
  // password and the form error go with it; the email stays for the next attempt.
  function close() {
    setOpen(false);
    presenter.clearSecret();
  }

  return (
    <>
      <Button className="on-green" onClick={() => setOpen(true)}>Đăng nhập</Button>
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
      />
    </>
  );
}
