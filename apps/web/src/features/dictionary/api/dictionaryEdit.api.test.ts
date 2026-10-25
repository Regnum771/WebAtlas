import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addValue, fetchHistory, fetchLayerEntry, patchAttribute, patchLayer, patchValue, previewStoredUnit, restoreFields, restoreValue,
} from './dictionaryEdit.api';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('../../../shared/api/apiClient', () => ({ apiRequest }));

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockResolvedValue({});
});

/** The one call made: its URL, method and parsed JSON body. */
function sent() {
  expect(apiRequest).toHaveBeenCalledTimes(1);
  const [url, init] = apiRequest.mock.calls[0] as [string, RequestInit | undefined];
  return { url, method: init?.method, body: init?.body === undefined ? undefined : JSON.parse(init.body as string) };
}

describe('fetchHistory', () => {
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

describe('the edit calls', () => {
  it('fetchLayerEntry GETs one layer', async () => {
    await fetchLayerEntry('dams');
    expect(apiRequest).toHaveBeenCalledWith('/api/dictionary/dams');
  });

  it('patchLayer PATCHes the layer with the body', async () => {
    await patchLayer('dams', { expectedRevision: 3, name: 'Đập' });
    expect(sent()).toEqual({ url: '/api/dictionary/dams', method: 'PATCH', body: { expectedRevision: 3, name: 'Đập' } });
  });

  it('patchAttribute PATCHes the attribute, its name encoded', async () => {
    await patchAttribute('dams', 'wattage mw', { expectedRevision: 5, label: 'Công suất' });
    expect(sent()).toEqual({ url: '/api/dictionary/dams/wattage%20mw', method: 'PATCH', body: { expectedRevision: 5, label: 'Công suất' } });
  });

  it("restoreFields POSTs the layer's restore with its revision", async () => {
    await restoreFields('dams', null, { expectedRevision: 3, fields: ['name'] });
    expect(sent()).toEqual({ url: '/api/dictionary/dams/restore', method: 'POST', body: { expectedRevision: 3, fields: ['name'] } });
  });

  it("restoreFields POSTs an attribute's restore with its revision", async () => {
    await restoreFields('dams', 'wattage_mw', { expectedRevision: 5, fields: ['label', 'definition'] });
    expect(sent()).toEqual({
      url: '/api/dictionary/dams/wattage_mw/restore', method: 'POST', body: { expectedRevision: 5, fields: ['label', 'definition'] },
    });
  });

  it('addValue POSTs the new code to the values of the attribute', async () => {
    await addValue('stations', 'station_type', { expectedRevision: 7, code: 'wind', name: 'Gió' });
    expect(sent()).toEqual({
      url: '/api/dictionary/stations/station_type/values', method: 'POST', body: { expectedRevision: 7, code: 'wind', name: 'Gió' },
    });
  });

  it('patchValue PATCHes one value, its code encoded', async () => {
    await patchValue('stations', 'station_type', 'Đo mực nước', { expectedRevision: 7, colorHint: null });
    expect(sent()).toEqual({
      url: `/api/dictionary/stations/station_type/values/${encodeURIComponent('Đo mực nước')}`, method: 'PATCH',
      body: { expectedRevision: 7, colorHint: null },
    });
  });

  it("restoreValue POSTs one value's restore with the attribute's revision", async () => {
    await restoreValue('dams', 'status', 'dang van hanh', { expectedRevision: 9, fields: ['name', 'definition', 'colorHint'] });
    expect(sent()).toEqual({
      url: '/api/dictionary/dams/status/values/dang%20van%20hanh/restore', method: 'POST',
      body: { expectedRevision: 9, fields: ['name', 'definition', 'colorHint'] },
    });
  });

  it('previewStoredUnit POSTs the proposed unit', async () => {
    apiRequest.mockResolvedValue({ rows: [] });
    await expect(previewStoredUnit('dams', 'wattage_mw', 'kW')).resolves.toEqual({ rows: [] });
    expect(sent()).toEqual({ url: '/api/dictionary/dams/wattage_mw/stored-unit/preview', method: 'POST', body: { storedUnit: 'kW' } });
  });
});
