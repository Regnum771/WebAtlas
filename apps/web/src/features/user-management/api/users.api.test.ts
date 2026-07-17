import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../shared/api/apiClient', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../shared/api/apiClient';
import { listUsers, createUser, updateUser } from './users.api';

const mockApi = apiRequest as ReturnType<typeof vi.fn>;
afterEach(() => vi.clearAllMocks());

describe('listUsers', () => {
  it('GETs /api/users and unwraps the users array', async () => {
    mockApi.mockResolvedValue({ users: [{ id: 'u1', email: 'a@b.test' }] });
    const out = await listUsers();
    expect(out).toEqual([{ id: 'u1', email: 'a@b.test' }]);
    expect(mockApi.mock.calls[0][0]).toBe('/api/users');
  });
});

describe('createUser', () => {
  it('POSTs the input and unwraps user', async () => {
    mockApi.mockResolvedValue({ user: { id: 'new' } });
    const input = { email: 'e@b.test', password: 'password1', full_name: 'E', role: 'editor' as const };
    const out = await createUser(input);
    expect(out).toEqual({ id: 'new' });
    const [path, init] = mockApi.mock.calls[0];
    expect(path).toBe('/api/users');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(input);
  });
});

describe('updateUser', () => {
  it('PUTs the patch to :id and unwraps user', async () => {
    mockApi.mockResolvedValue({ user: { id: 'u1' } });
    const out = await updateUser('u1', { is_active: false });
    expect(out).toEqual({ id: 'u1' });
    const [path, init] = mockApi.mock.calls[0];
    expect(path).toBe('/api/users/u1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ is_active: false });
  });
});
