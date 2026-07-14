import { useState, useCallback } from 'react';
import { useSession } from '../../../entities/session/model/session.store';
import { ApiError } from '../../../shared/api/apiClient';

function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Invalid email or password';
    if (e.status === 429) return 'Too many attempts, please wait and try again';
    if (e.status === 0 || e.code === 'NETWORK_ERROR') return 'Cannot reach the server';
    return e.message;
  }
  return 'Something went wrong';
}

export function useLoginPresenter(onSuccess?: () => void) {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await login({ email, password });
      onSuccess?.();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setLoading(false);
    }
  }, [login, email, password, onSuccess]);

  return { email, password, loading, error, setEmail, setPassword, submit };
}
