import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/api/apiClient', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../shared/api/apiClient';
import { createFeature } from './features.api';

describe('createFeature', () => {
  it('POSTs the geometry + properties and returns the new id', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ feature: { id: 'new-uuid' } });
    const payload = { geometry: { type: 'Point', coordinates: [108, 13] }, properties: { name: 'X' } };
    const out = await createFeature('dams', payload);
    expect(out).toEqual({ id: 'new-uuid' });
    const [path, init] = (apiRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/api/layers/dams/features');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(payload);
  });
});
