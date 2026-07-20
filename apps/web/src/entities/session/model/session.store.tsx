import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { setAuthToken, onUnauthorized } from '../../../shared/api/apiClient';
import { loginRequest, fetchMe } from '../api/session.api';
import type { CurrentUser, LoginCredentials } from './session.types';

export const TOKEN_KEY = 'webatlas.token';

type Status = 'anonymous' | 'authenticating' | 'authenticated';

interface SessionContextValue {
  status: Status;
  currentUser: CurrentUser | null;
  login: (c: LoginCredentials) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() =>
    localStorage.getItem(TOKEN_KEY) ? 'authenticating' : 'anonymous'
  );
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setCurrentUser(null);
    setStatus('anonymous');
  }, []);

  // apiClient calls this on any 401 (expired/invalid token mid-session).
  useEffect(() => { onUnauthorized(logout); }, [logout]);

  const login = useCallback(async (c: LoginCredentials) => {
    setStatus('authenticating');
    try {
      const { token, user } = await loginRequest(c);
      localStorage.setItem(TOKEN_KEY, token);
      setAuthToken(token);
      setCurrentUser(user);
      setStatus('authenticated');
    } catch (e) {
      logout();
      throw e;
    }
  }, [logout]);

  // Rehydrate once on mount from a stored token.
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return;
    setAuthToken(stored);
    setStatus('authenticating');
    fetchMe()
      .then((user) => { setCurrentUser(user); setStatus('authenticated'); })
      .catch(() => { logout(); });
  }, [logout]);

  return (
    <SessionContext.Provider value={{ status, currentUser, login, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within an AuthProvider');
  return ctx;
}
