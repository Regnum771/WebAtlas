import { describe, it, expect, vi, beforeEach } from 'vitest';
import { goToSearchHit } from './goToHit';
import { hitBadge, hitDisplayName } from './hitLabel';
import type { SearchHit } from '../api/search.api';

const fetchFeatureGeometry = vi.fn();
vi.mock('../api/search.api', async (orig) => ({
  ...(await orig<typeof import('../api/search.api')>()),
  fetchFeatureGeometry: (...args: unknown[]) => fetchFeatureGeometry(...args),
}));

const lake: SearchHit = { layerKey: 'lakes', featureId: 'l1', name: 'Hồ Lắk', source: 'layer', lonLat: [108.2, 12.4] };
const road: SearchHit = {
  layerKey: 'roads', featureId: 'roads:0123456789abcdef0123456789abcdef:0', name: 'Quốc lộ 14', source: 'reference', lonLat: [108.05, 12.67],
};

describe('goToSearchHit', () => {
  beforeEach(() => { fetchFeatureGeometry.mockReset(); });

  it('draws and frames the whole geometry of an editable feature', async () => {
    fetchFeatureGeometry.mockResolvedValue({ name: 'Sông Ba', geometry: { type: 'LineString', coordinates: [[108, 13], [108.5, 13.4]] } });
    const run = vi.fn();
    goToSearchHit(lake, run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0]).toMatchObject({ kind: 'showGeometries', fit: true, items: [{ role: 'highlight', label: 'Sông Ba', layerKey: 'lakes', featureId: 'l1' }] });
  });

  it('falls back to zooming to the point when the geometry request fails', async () => {
    fetchFeatureGeometry.mockRejectedValue(new Error('offline'));
    const run = vi.fn();
    goToSearchHit(lake, run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0]).toEqual({ kind: 'zoomToFeature', layerKey: 'lakes', featureId: 'l1', lonLat: [108.2, 12.4] });
  });

  it('moves to a reference entity as a point and never fetches it as an editable feature', () => {
    const run = vi.fn();
    goToSearchHit(road, run);
    expect(run).toHaveBeenCalledWith({
      kind: 'showGeometries', fit: true, items: [{ geometry: { type: 'Point', coordinates: road.lonLat }, role: 'highlight', label: 'Quốc lộ 14' }],
    });
    expect(fetchFeatureGeometry).not.toHaveBeenCalled();
  });
});

describe('hit labels', () => {
  it('tags reference hits as basemap data and admin units by level', () => {
    expect(hitBadge(road)).toBe('Nền bản đồ');
    expect(hitBadge({ ...lake, source: 'admin', layerKey: 'province' } as SearchHit)).toBe('Tỉnh');
    expect(hitBadge({ ...lake, source: 'admin', layerKey: 'ward' } as SearchHit)).toBe('Xã/phường');
    expect(hitBadge(lake)).toBe('Hồ');
  });

  it('drops a leading tag word from the name, and names a nameless hit', () => {
    expect(hitDisplayName('Sông Srêpốk', 'Sông')).toBe('Srêpốk');
    expect(hitDisplayName('Hồ Lắk', 'Sông')).toBe('Hồ Lắk');
    expect(hitDisplayName(null, 'Sông')).toBe('(không tên)');
  });
});
