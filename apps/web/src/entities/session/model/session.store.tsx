import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { setAuthToken, onUnauthorized } from '../../../shared/api/apiClient';
import { loginRequest, fetchMe, fetchAuthConfig } from '../api/session.api';
import type { CurrentUser, LoginCredentials, SignInMethod } from './session.types';

export const TOKEN_KEY = 'webatlas.token';
/** How the stored token was obtained: a WebAtlas password, or the platform's single sign-on. */
export const METHOD_KEY = 'webatlas.signInMethod';
/** The SSO ID token, kept only to end the Keycloak session on sign-out (id_token_hint). */
export const ID_TOKEN_KEY = 'webatlas.idToken';

type Status = 'anonymous' | 'authenticating' | 'authenticated';

interface SessionContextValue {
  status: Status;
  currentUser: CurrentUser | null;
  method: SignInMethod;
  login: (c: LoginCredentials) => Promise<void>;
  /** Stores the token the SSO callback delivered, then loads the user. */
  completeSso: (token: string, idToken: string | null) => Promise<void>;
  /** The user signing out; with SSO this also ends the Keycloak session (a full-page redirect). */
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

const storedMethod = (): SignInMethod => (localStorage.getItem(METHOD_KEY) === 'sso' ? 'sso' : 'local');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() =>
    localStorage.getItem(TOKEN_KEY) ? 'authenticating' : 'anonymous'
  );
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [method, setMethod] = useState<SignInMethod>(storedMethod);

  // Forgets the session locally. Used on a 401 too, where redirecting to Keycloak would be wrong.
  const clear = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(METHOD_KEY);
    localStorage.removeItem(ID_TOKEN_KEY);
    setAuthToken(null);
    setCurrentUser(null);
    setMethod('local');
    setStatus('anonymous');
  }, []);

  const logout = useCallback(() => {
    const wasSso = localStorage.getItem(METHOD_KEY) === 'sso';
    const idToken = localStorage.getItem(ID_TOKEN_KEY);
    clear();
    if (!wasSso) return;
    void fetchAuthConfig()
      .then(({ sso }) => {
        if (!sso) return;
        const url = new URL(sso.endSessionUrl);
        if (idToken) url.searchParams.set('id_token_hint', idToken);
        window.location.assign(url.toString());
      })
      .catch(() => { /* the local session is gone; Keycloak's ends on its own timeout */ });
  }, [clear]);

  // apiClient calls this on any 401 (expired/invalid token mid-session).
  useEffect(() => { onUnauthorized(clear); }, [clear]);

  const login = useCallback(async (c: LoginCredentials) => {
    setStatus('authenticating');
    try {
      const { token, user } = await loginRequest(c);
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(METHOD_KEY, 'local');
      setAuthToken(token);
      setCurrentUser(user);
      setMethod('local');
      setStatus('authenticated');
    } catch (e) {
      clear();
      throw e;
    }
  }, [clear]);

  const completeSso = useCallback(async (token: string, idToken: string | null) => {
    setStatus('authenticating');
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(METHOD_KEY, 'sso');
    if (idToken) localStorage.setItem(ID_TOKEN_KEY, idToken);
    setAuthToken(token);
    try {
      const user = await fetchMe();
      setCurrentUser(user);
      setMethod('sso');
      setStatus('authenticated');
    } catch (e) {
      clear();
      throw e;
    }
  }, [clear]);

  // Rehydrate once on mount from a stored token.
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return;
    setAuthToken(stored);
    setStatus('authenticating');
    fetchMe()
      .then((user) => { setCurrentUser(user); setStatus('authenticated'); })
      .catch(() => { clear(); });
  }, [clear]);

  return (
    <SessionContext.Provider value={{ status, currentUser, method, login, completeSso, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within an AuthProvider');
  return ctx;
}
