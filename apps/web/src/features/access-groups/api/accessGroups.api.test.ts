import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiRequest = vi.fn();
vi.mock('../../../shared/api/apiClient', () => ({ apiRequest: (p: string, i?: unknown) => apiRequest(p, i) }));

import { listGroups, createGroup, updateGroup, deleteGroup } from './accessGroups.api';

beforeEach(() => apiRequest.mockReset());

describe('accessGroups.api', () => {
  it('lists groups from the envelope', async () => {
    apiRequest.mockResolvedValue({ groups: [{ id: 'g1' }] });
    expect(await listGroups()).toEqual([{ id: 'g1' }]);
    expect(apiRequest).toHaveBeenCalledWith('/api/access-groups', undefined);
  });

  it('creates with POST and unwraps the group', async () => {
    apiRequest.mockResolvedValue({ group: { id: 'g1' } });
    const input = { name: 'A', units: ['VN'], permissions: ['map.import' as const] };
    expect(await createGroup(input)).toEqual({ id: 'g1' });
    expect(apiRequest).toHaveBeenCalledWith('/api/access-groups', { method: 'POST', body: JSON.stringify(input) });
  });

  it('updates with PUT and deletes with DELETE', async () => {
    apiRequest.mockResolvedValue({ group: { id: 'g1' } });
    await updateGroup('g1', { name: 'B', units: ['48'], permissions: ['map.import'] });
    expect(apiRequest).toHaveBeenLastCalledWith('/api/access-groups/g1', expect.objectContaining({ method: 'PUT' }));
    apiRequest.mockResolvedValue(undefined);
    await deleteGroup('g1');
    expect(apiRequest).toHaveBeenLastCalledWith('/api/access-groups/g1', { method: 'DELETE' });
  });
});
