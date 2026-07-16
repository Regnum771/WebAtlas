import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../shared/api/apiClient', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../shared/api/apiClient';
import { createFeature, updateFeature, deleteFeature } from './features.api';

afterEach(() => {
  vi.clearAllMocks();
});

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

describe('updateFeature', () => {
  it('PUTs geometry + properties to :id and returns the id', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ feature: { id: 'u1' } });
    const payload = { geometry: { type: 'Point', coordinates: [108, 13] }, properties: { name: 'X' } };
    const out = await updateFeature('dams', 'u1', payload);
    expect(out).toEqual({ id: 'u1' });
    const [path, init] = (apiRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/api/layers/dams/features/u1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('PUTs attribute-only (no geometry) when geometry omitted', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ feature: { id: 'u2' } });
    await updateFeature('rivers', 'u2', { properties: { name: 'R' } });
    const [, init] = (apiRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ properties: { name: 'R' } });
  });
});

describe('deleteFeature', () => {
  it('DELETEs :id and resolves', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await deleteFeature('dams', 'd1');
    const [path, init] = (apiRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/api/layers/dams/features/d1');
    expect(init.method).toBe('DELETE');
  });
});
