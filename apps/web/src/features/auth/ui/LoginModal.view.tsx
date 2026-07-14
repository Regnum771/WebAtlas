import { Modal } from '../../../shared/ui/Modal';

// Passive view: props only. Must not import apiClient/session/ol.
export interface LoginModalViewProps {
  open: boolean;
  email: string;
  password: string;
  loading: boolean;
  error: string | null;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function LoginModalView(props: LoginModalViewProps) {
  const { open, email, password, loading, error, onEmail, onPassword, onSubmit, onClose } = props;
  return (
    <Modal open={open} onClose={onClose}>
      <form
        className="login-form"
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      >
        <h2>Admin login</h2>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email" type="email" autoComplete="username" value={email}
          onChange={(e) => onEmail(e.target.value)}
          required
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password" type="password" autoComplete="current-password" value={password}
          onChange={(e) => onPassword(e.target.value)}
          required
        />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? 'Logging in…' : 'Log in'}</button>
      </form>
    </Modal>
  );
}
