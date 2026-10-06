import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginModalView } from './LoginModal.view';
import type { LoginField } from '../model/useLoginPresenter';
import { validateEmail, validatePassword } from '../model/loginValidation';

const baseProps = {
  open: true,
  values: { email: '', password: '' },
  errors: {},
  formError: null,
  loading: false,
  onField: vi.fn(),
  onBlur: vi.fn(),
  onSubmit: vi.fn((): LoginField | null => null),
  onClose: vi.fn(),
};

const validators = { email: validateEmail, password: validatePassword };

// A small stateful host that mimics the presenter's rules, so the view is exercised end to end.
function Host() {
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<Partial<Record<LoginField, string>>>({});
  const check = (name: LoginField, value: string) => {
    const message = validators[name](value);
    setErrors((e) => {
      const next = { ...e };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });
  };
  return (
    <LoginModalView
      {...baseProps}
      values={values}
      errors={errors}
      onField={(name, value) => {
        setValues((v) => ({ ...v, [name]: value }));
        if (errors[name]) check(name, value);
      }}
      onBlur={(name) => check(name, values[name])}
      onSubmit={() => {
        const next: Partial<Record<LoginField, string>> = {};
        let first: LoginField | null = null;
        for (const name of ['email', 'password'] as const) {
          const message = validators[name](values[name]);
          if (message) {
            next[name] = message;
            first ??= name;
          }
        }
        setErrors(next);
        return first;
      }}
    />
  );
}

describe('LoginModalView', () => {
  it('renders the fields and the submit button in Vietnamese under a dialog titled Đăng nhập', () => {
    render(<LoginModalView {...baseProps} />);
    expect(screen.getByRole('dialog', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toHaveAttribute('type', 'submit');
  });

  it('renders nothing when closed', () => {
    const { container } = render(<LoginModalView {...baseProps} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports typing and leaving a field through onField and onBlur', async () => {
    const onField = vi.fn();
    const onBlur = vi.fn();
    render(<LoginModalView {...baseProps} onField={onField} onBlur={onBlur} />);
    await userEvent.type(screen.getByLabelText('Email'), 'a');
    expect(onField).toHaveBeenCalledWith('email', 'a');
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledWith('email');
  });

  it('shows the field error under its field after the field is left', async () => {
    render(<Host />);
    await userEvent.click(screen.getByLabelText('Email'));
    await userEvent.tab();
    const email = screen.getByLabelText('Email');
    expect(screen.getByText('Nhập email.')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Nhập email.');
  });

  it('clears the error on the keystroke that fixes it', async () => {
    render(<Host />);
    await userEvent.click(screen.getByLabelText('Email'));
    await userEvent.tab();
    expect(screen.getByText('Nhập email.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'a');
    expect(screen.getByText('Email thiếu phần sau dấu @.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), '@b.vn');
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Email chưa đúng dạng.')).not.toBeInTheDocument();
    expect(screen.queryByText('Email thiếu phần sau dấu @.')).not.toBeInTheDocument();
  });

  it('focuses the first field in error on a failed submit', async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(screen.getByLabelText('Email')).toHaveFocus();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.vn');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(screen.getByLabelText('Mật khẩu')).toHaveFocus();
  });

  it('Enter in the password field submits', async () => {
    const onSubmit = vi.fn((): LoginField | null => null);
    render(<LoginModalView {...baseProps} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Mật khẩu'), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows the form error above the submit button as an alert', () => {
    render(
      <LoginModalView
        {...baseProps}
        formError={{ title: 'Email hoặc mật khẩu không đúng', body: 'Kiểm tra lại rồi thử lần nữa.' }}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Email hoặc mật khẩu không đúng');
    expect(alert).toHaveTextContent('Kiểm tra lại rồi thử lần nữa.');
    expect(alert.nextElementSibling).toBe(screen.getByRole('button', { name: 'Đăng nhập' }));
  });

  it('shows a busy submit button while loading', () => {
    render(<LoginModalView {...baseProps} loading />);
    expect(screen.getByRole('button', { name: 'Đang đăng nhập' })).toHaveAttribute('aria-busy', 'true');
  });

  it('does not submit while loading', async () => {
    const onSubmit = vi.fn((): LoginField | null => null);
    render(<LoginModalView {...baseProps} loading onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Đang đăng nhập' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Hiện shows the password and becomes Ẩn, without submitting', async () => {
    const onSubmit = vi.fn((): LoginField | null => null);
    render(<LoginModalView {...baseProps} onSubmit={onSubmit} />);
    const toggle = screen.getByRole('button', { name: 'Hiện' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ẩn' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Ẩn' }));
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'password');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('closing hides the password again, so reopening never shows it in clear text', async () => {
    const { rerender } = render(<LoginModalView {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hiện' }));
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'text');
    rerender(<LoginModalView {...baseProps} open={false} />);
    rerender(<LoginModalView {...baseProps} />);
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Hiện' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not use the browser validation bubbles', () => {
    render(<LoginModalView {...baseProps} />);
    expect(screen.getByLabelText('Email')).not.toBeRequired();
    expect(screen.getByLabelText('Email').closest('form')).toHaveAttribute('novalidate');
  });
});
