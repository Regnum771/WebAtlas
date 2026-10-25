import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchHistory } from './dictionaryEdit.api';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('../../../shared/api/apiClient', () => ({ apiRequest }));

describe('fetchHistory', () => {
  beforeEach(() => apiRequest.mockReset());

  it('unwraps the { history } body the route answers into the list', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    apiRequest.mockResolvedValue({ history: rows });
    await expect(fetchHistory('dams', 'wattage_mw', 50)).resolves.toEqual(rows);
    expect(apiRequest).toHaveBeenCalledWith('/api/dictionary/history?layer=dams&attribute=wattage_mw&limit=50');
  });

  it('omits the attribute for the layer-wide history', async () => {
    apiRequest.mockResolvedValue({ history: [] });
    await fetchHistory('dams', null);
    expect(apiRequest).toHaveBeenCalledWith('/api/dictionary/history?layer=dams&limit=200');
  });
});
