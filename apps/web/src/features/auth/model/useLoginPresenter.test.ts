import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLoginPresenter } from './useLoginPresenter';
import type { LoginField } from './useLoginPresenter';
import { ApiError } from '../../../shared/api/apiClient';

const loginMock = vi.fn();
vi.mock('../../../entities/session/model/session.store', () => ({
  useSession: () => ({ login: loginMock, status: 'anonymous', currentUser: null, logout: vi.fn() }),
}));

type Hook = { current: ReturnType<typeof useLoginPresenter> };

function fill(result: Hook, email = 'a@webatlas.test', password = 'pw') {
  act(() => {
    result.current.set('email', email);
    result.current.set('password', password);
  });
}

function submit(result: Hook): LoginField | null {
  let field: LoginField | null = null;
  act(() => { field = result.current.submit(); });
  return field;
}

describe('useLoginPresenter', () => {
  beforeEach(() => { loginMock.mockReset(); });

  it('sends nothing and names the first field in error when the form is incomplete', () => {
    const { result } = renderHook(() => useLoginPresenter());
    expect(submit(result)).toBe('email');
    expect(loginMock).not.toHaveBeenCalled();
    expect(result.current.errors.email).toBe('Nhập email.');
    expect(result.current.errors.password).toBe('Nhập mật khẩu.');
  });

  it('names the password when only it is missing', () => {
    const { result } = renderHook(() => useLoginPresenter());
    act(() => { result.current.set('email', 'a@b.vn'); });
    expect(submit(result)).toBe('password');
  });

  it('sends the credentials and calls onSuccess after a good sign-in', async () => {
    loginMock.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLoginPresenter(onSuccess));
    fill(result);
    expect(submit(result)).toBeNull();
    expect(loginMock).toHaveBeenCalledWith({ email: 'a@webatlas.test', password: 'pw' });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(false);
    expect(result.current.formError).toBeNull();
  });

  it('keeps the password after a 401', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'AUTH_ERROR', 'Invalid credentials'));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLoginPresenter(onSuccess));
    fill(result, 'a@webatlas.test', 'secret');
    submit(result);
    await waitFor(() => expect(result.current.formError).not.toBeNull());
    expect(result.current.values).toEqual({ email: 'a@webatlas.test', password: 'secret' });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it.each([
    [new ApiError(401, 'AUTH_ERROR', 'x'), 'Email hoặc mật khẩu không đúng', 'Kiểm tra lại rồi thử lần nữa.'],
    [new ApiError(429, 'RATE_LIMIT', 'x'), 'Thử quá nhiều lần', 'Đợi một lát rồi thử lại.'],
    [new ApiError(0, 'NETWORK_ERROR', 'x'), 'Không kết nối được máy chủ', 'Kiểm tra mạng rồi thử lại.'],
    [new ApiError(500, 'HTTP_ERROR', 'x'), 'Chưa đăng nhập được', 'Thử lại sau.'],
    [new Error('boom'), 'Chưa đăng nhập được', 'Thử lại sau.'],
  ])('maps %j to its message', async (error, title, body) => {
    loginMock.mockRejectedValue(error);
    const { result } = renderHook(() => useLoginPresenter());
    fill(result);
    submit(result);
    await waitFor(() => expect(result.current.formError).toEqual({ title, body }));
  });

  it('clears the form error when a new request starts', async () => {
    loginMock.mockRejectedValueOnce(new ApiError(401, 'AUTH_ERROR', 'x'));
    const { result } = renderHook(() => useLoginPresenter());
    fill(result);
    submit(result);
    await waitFor(() => expect(result.current.formError).not.toBeNull());
    loginMock.mockReturnValue(new Promise(() => {}));
    submit(result);
    expect(result.current.formError).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('a second submit while the first is in flight sends one request', () => {
    loginMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLoginPresenter());
    fill(result);
    submit(result);
    submit(result);
    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a new submit once the request has settled', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'AUTH_ERROR', 'x'));
    const { result } = renderHook(() => useLoginPresenter());
    fill(result);
    submit(result);
    await waitFor(() => expect(result.current.loading).toBe(false));
    submit(result);
    expect(loginMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
