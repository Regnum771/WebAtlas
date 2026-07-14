import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AuthProvider, useSession, TOKEN_KEY } from './session.store';

vi.mock('../api/session.api', () => ({
  loginRequest: vi.fn(),
  fetchMe: vi.fn(),
}));
import { loginRequest, fetchMe } from '../api/session.api';

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

  it('clears the session when rehydration fails (expired token)', async () => {
    localStorage.setItem(TOKEN_KEY, 'stale-tok');
    (fetchMe as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('401'));
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
