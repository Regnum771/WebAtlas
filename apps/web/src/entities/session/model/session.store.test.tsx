import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AuthProvider, useSession, TOKEN_KEY, METHOD_KEY, ID_TOKEN_KEY } from './session.store';

vi.mock('../api/session.api', () => ({
  loginRequest: vi.fn(),
  fetchMe: vi.fn(),
  fetchAuthConfig: vi.fn(),
}));
import { loginRequest, fetchMe, fetchAuthConfig } from '../api/session.api';
import { notifyUnauthorized } from '../../../shared/api/apiClient';

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const ADMIN = { id: '1', email: 'a@webatlas.test', full_name: 'A', role: 'admin' as const };

describe('session store', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('starts anonymous with no stored token', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(result.current.currentUser).toBeNull();
  });

  it('login stores token + user and becomes authenticated', async () => {
    (loginRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'tok', user: ADMIN });
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(async () => { await result.current.login({ email: ADMIN.email, password: 'pw' }); });
    expect(result.current.status).toBe('authenticated');
    expect(result.current.currentUser).toEqual(ADMIN);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok');
  });

  it('logout clears token + user', async () => {
    (loginRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'tok', user: ADMIN });
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(async () => { await result.current.login({ email: ADMIN.email, password: 'pw' }); });
    act(() => { result.current.logout(); });
    expect(result.current.status).toBe('anonymous');
    expect(result.current.currentUser).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('rehydrates from a stored token via fetchMe', async () => {
    localStorage.setItem(TOKEN_KEY, 'stored-tok');
    (fetchMe as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.currentUser).toEqual(ADMIN);
  });

  it('completeSso stores the token, the ID token and the method', async () => {
    (fetchMe as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN);
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(async () => { await result.current.completeSso('tok', 'idt'); });
    expect(result.current.status).toBe('authenticated');
    expect(result.current.method).toBe('sso');
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok');
    expect(localStorage.getItem(METHOD_KEY)).toBe('sso');
    expect(localStorage.getItem(ID_TOKEN_KEY)).toBe('idt');
  });

  it('signing out of an SSO session ends the Keycloak session with the ID token hint', async () => {
    (fetchMe as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN);
    (fetchAuthConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      sso: { loginPath: '/api/auth/oidc/login', endSessionUrl: 'http://kc/logout?client_id=webatlas-api' },
    });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    try {
      const { result } = renderHook(() => useSession(), { wrapper });
      await act(async () => { await result.current.completeSso('tok', 'idt'); });
      act(() => { result.current.logout(); });
      expect(result.current.status).toBe('anonymous');
      expect(localStorage.getItem(ID_TOKEN_KEY)).toBeNull();
      await waitFor(() => expect(assign).toHaveBeenCalledWith('http://kc/logout?client_id=webatlas-api&id_token_hint=idt'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a 401 forgets an SSO session without leaving for Keycloak', async () => {
    (fetchMe as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN);
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(async () => { await result.current.completeSso('tok', 'idt'); });
    act(() => { notifyUnauthorized(); });
    expect(result.current.status).toBe('anonymous');
    expect(fetchAuthConfig).not.toHaveBeenCalled();
  });

  it('a local sign-out never asks for the SSO configuration', async () => {
    (loginRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'tok', user: ADMIN });
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(async () => { await result.current.login({ email: ADMIN.email, password: 'pw' }); });
    expect(result.current.method).toBe('local');
    act(() => { result.current.logout(); });
    expect(fetchAuthConfig).not.toHaveBeenCalled();
  });

  it('clears the session when rehydration fails (expired token)', async () => {
    localStorage.setItem(TOKEN_KEY, 'stale-tok');
    (fetchMe as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('401'));
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
