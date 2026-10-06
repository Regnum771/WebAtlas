import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Dialog } from '../../../shared/ui/Dialog';
import { TextField } from '../../../shared/ui/TextField';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import type { LoginField, LoginFormError } from '../model/useLoginPresenter';

// Passive view: props only. Must not import apiClient/session/ol.
export interface LoginModalViewProps {
  open: boolean;
  values: Record<LoginField, string>;
  errors: Partial<Record<LoginField, string>>;
  formError: LoginFormError | null;
  loading: boolean;
  onField: (name: LoginField, value: string) => void;
  onBlur: (name: LoginField) => void;
  /** Returns the first field in error (nothing was sent), or null. */
  onSubmit: () => LoginField | null;
  onClose: () => void;
}

export function LoginModalView(props: LoginModalViewProps) {
  const { open, values, errors, formError, loading, onField, onBlur, onSubmit, onClose } = props;
  const [shown, setShown] = useState(false);
  const inputs = {
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const invalid = onSubmit();
    if (invalid) inputs[invalid].current?.focus();
  };

  return (
    <Dialog open={open} title="Đăng nhập" onClose={onClose}>
      <form className="form-stack" noValidate onSubmit={handleSubmit}>
        <TextField
          ref={inputs.email}
          id="login-email"
          label="Email"
          type="email"
          autoComplete="username"
          value={values.email}
          error={errors.email}
          onChange={(e) => onField('email', e.target.value)}
          onBlur={() => onBlur('email')}
        />
        <TextField
          ref={inputs.password}
          id="login-password"
          label="Mật khẩu"
          type={shown ? 'text' : 'password'}
          autoComplete="current-password"
          value={values.password}
          error={errors.password}
          onChange={(e) => onField('password', e.target.value)}
          onBlur={() => onBlur('password')}
          trailing={
            <button type="button" className="link" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
              {shown ? 'Ẩn' : 'Hiện'}
            </button>
          }
        />
        {formError && (
          <Message tone="error" title={formError.title}>
            {formError.body}
          </Message>
        )}
        <Button type="submit" variant="solid" busy={loading} busyLabel="Đang đăng nhập">
          Đăng nhập
        </Button>
      </form>
    </Dialog>
  );
}
