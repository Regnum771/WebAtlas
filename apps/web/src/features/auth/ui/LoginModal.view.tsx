import { useEffect, useRef, useState } from 'react';
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
  /** Set when the platform's single sign-on is configured: it leads, the password form follows. */
  onSso?: () => void;
}

export function LoginModalView(props: LoginModalViewProps) {
  const { open, values, errors, formError, loading, onField, onBlur, onSubmit, onClose, onSso } = props;
  const [shown, setShown] = useState(false);
  // A closed dialog forgets Hiện, so reopening never shows the password in clear text.
  useEffect(() => { if (!open) setShown(false); }, [open]);
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
      <div data-slot="login" className="flex w-[min(340px,80vw)] flex-col gap-4 text-body">
        {onSso && (
          // .login-sso: browser scripts find the single sign-on button through it.
          <div className="login-sso flex flex-col gap-3">
            <Button variant="solid" onClick={onSso}>Đăng nhập một lần</Button>
            <p className="flex items-center gap-2 text-label text-ink-2 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
              Hoặc dùng tài khoản WebATLAS
            </p>
          </div>
        )}
        <form className="flex flex-col gap-3" noValidate onSubmit={handleSubmit}>
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
              <button
                type="button"
                aria-pressed={shown}
                onClick={() => setShown((s) => !s)}
                className="cursor-pointer px-1 text-label font-semibold text-water hover:underline"
              >
                {shown ? 'Ẩn' : 'Hiện'}
              </button>
            }
          />
          {formError && (
            <Message tone="error" title={formError.title}>
              {formError.body}
            </Message>
          )}
          <Button type="submit" variant={onSso ? 'outline' : 'solid'} busy={loading} busyLabel="Đang đăng nhập">
            Đăng nhập
          </Button>
        </form>
      </div>
    </Dialog>
  );
}
