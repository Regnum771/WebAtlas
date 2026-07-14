import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoginPresenter } from './useLoginPresenter';
import { ApiError } from '../../../shared/api/apiClient';

const loginMock = vi.fn();
vi.mock('../../../entities/session/model/session.store', () => ({
  useSession: () => ({ login: loginMock, status: 'anonymous', currentUser: null, logout: vi.fn() }),
}));

describe('useLoginPresenter', () => {
  beforeEach(() => { loginMock.mockReset(); });

  it('submits credentials and calls onSuccess', async () => {
    loginMock.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLoginPresenter(onSuccess));
    act(() => { result.current.setEmail('a@webatlas.test'); result.current.setPassword('pw'); });
    await act(async () => { await result.current.submit(); });
    expect(loginMock).toHaveBeenCalledWith({ email: 'a@webatlas.test', password: 'pw' });
    expect(onSuccess).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('maps a 401 to a friendly error and does not call onSuccess', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'AUTH_ERROR', 'Invalid credentials'));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLoginPresenter(onSuccess));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Invalid email or password');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('maps a network error', async () => {
    loginMock.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'down'));
    const { result } = renderHook(() => useLoginPresenter());
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Cannot reach the server');
  });
});
