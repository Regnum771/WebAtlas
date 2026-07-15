import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/api/apiClient', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../shared/api/apiClient';
import { fetchLayerCatalog } from './layersCatalog.api';

describe('fetchLayerCatalog', () => {
  it('GETs /api/layers and returns the layers array', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      layers: [{ key: 'dams', geomType: 'Point', attributes: ['name', 'status'] }],
    });
    const out = await fetchLayerCatalog();
    expect(apiRequest).toHaveBeenCalledWith('/api/layers');
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('dams');
    expect(out[0].geomType).toBe('Point');
    expect(out[0].attributes).toEqual(['name', 'status']);
  });
});
