import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiRequest, ApiError, setAuthToken, onUnauthorized } from './apiClient';

function mockFetchOnce(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return vi.fn().mockResolvedValue({
    ok, status,
    json: async () => body,
  } as Response);
}

describe('apiClient', () => {
  beforeEach(() => { setAuthToken(null); });

  it('injects the bearer token and returns parsed JSON on 2xx', async () => {
    const fetchMock = mockFetchOnce(200, { user: { id: '1' } });
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('tok123');
    const data = await apiRequest<{ user: { id: string } }>('/api/auth/me');
    expect(data.user.id).toBe('1');
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
  });

  it('maps the error envelope to ApiError on non-2xx', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(400, { error: { code: 'VALIDATION_ERROR', message: 'bad' } }));
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'bad' });
    await expect(apiRequest('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('invokes the unauthorized callback on 401 (and throws)', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(401, { error: { code: 'AUTH_ERROR', message: 'nope' } }));
    const cb = vi.fn();
    onUnauthorized(cb);
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 401 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke the unauthorized callback on 403', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(403, { error: { code: 'FORBIDDEN', message: 'no role' } }));
    const cb = vi.fn();
    onUnauthorized(cb);
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('maps a network failure to NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
