import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { ApiError } from '../../../shared/api/apiClient';
import { getToasts, resetToasts } from '../../../shared/ui/toast.store';
import { keys } from './queries';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ map: { id: 'the-map' }, sync: vi.fn() }));
const listMaps = vi.fn();
const getMap = vi.fn();
vi.mock('../api/workspace.api', () => ({ listMaps: () => listMaps(), getMap: (id: string) => getMap(id) }));
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => ({ map: h.map }) }));
vi.mock('./personalLayers', () => ({ PERSONAL_Z_BASE: 800, syncPersonalLayers: (...args: unknown[]) => h.sync(...args) }));

import { usePersonalLayersSync } from './usePersonalLayersSync';
import { expandMap, getMyMaps, resetMyMapsStore, setLayerOpacity, setLayerVisible } from './myMaps.store';
import type { PersonalLayerEntry } from './personalLayers';

const summary = (id: string, role: 'owner' | 'recipient') => ({
  id, title: id, description: '', ownerId: 'u', ownerName: 'Lan', revision: 1, updatedAt: '2026-10-01T00:00:00Z', layerCount: 2, role,
});
const layer = (id: string, position: number) => ({
  id, kind: 'free', title: id, position, style: {}, geometryType: 'point', fields: [], layerKey: null, draftId: null, featureCount: 0, raster: null,
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => usePersonalLayersSync(), { wrapper }) };
}
const lastEntries = () => h.sync.mock.calls[h.sync.mock.calls.length - 1][1] as PersonalLayerEntry[];

beforeEach(() => {
  h.sync.mockReset();
  resetMyMapsStore();
  resetToasts();
  listMaps.mockResolvedValue({ mine: [summary('m1', 'owner'), summary('m3', 'owner')], sharedWithMe: [summary('m2', 'recipient')] });
  getMap.mockImplementation(async (id: string) => ({
    ...summary(id, id === 'm2' ? 'recipient' : 'owner'),
    // Listed out of order: the panel sorts by position, and so does the map.
    layers: id === 'm1' ? [layer('b', 1), layer('a', 0)] : id === 'm2' ? [layer('c', 0)] : [layer('z', 0)],
  }));
});

describe('usePersonalLayersSync', () => {
  it("feeds the expanded maps' layers, the top row drawn highest, with the panel's visibility and opacity", async () => {
    expandMap('m1');
    expandMap('m2');
    setLayerVisible('b', false);
    setLayerOpacity('c', 0.5);
    const { unmount } = setup();
    await waitFor(() => expect(lastEntries().map((e) => e.layer.id)).toEqual(['a', 'b', 'c']));
    const entries = lastEntries();
    expect(h.sync.mock.calls[h.sync.mock.calls.length - 1][0]).toBe(h.map);
    expect(entries.map((e) => [e.mapId, e.zIndex, e.visible, e.opacity])).toEqual([
      ['m1', 802, true, 1],
      ['m1', 801, false, 1],
      ['m2', 800, true, 0.5],
    ]);
    // The note on a row comes from the loader through the store.
    act(() => entries[0].onTruncated('a', 5000));
    expect(getMyMaps().truncated).toEqual({ a: 5000 });
    // Signing out (the section unmounts) takes every personal layer off the map.
    unmount();
    expect(lastEntries()).toEqual([]);
  });

  it('a 404 on a shared map removes it and its layers', async () => {
    expandMap('m1');
    expandMap('m2');
    const { client } = setup();
    await waitFor(() => expect(lastEntries().map((e) => e.layer.id)).toEqual(['a', 'b', 'c']));
    // The owner revokes the share; the recipient's next read answers the map's own 404.
    getMap.mockImplementation(async (id: string) => {
      if (id === 'm2') throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy bản đồ.');
      return { ...summary(id, 'owner'), layers: id === 'm1' ? [layer('b', 1), layer('a', 0)] : [layer('z', 0)] };
    });
    listMaps.mockResolvedValue({ mine: [summary('m1', 'owner'), summary('m3', 'owner')], sharedWithMe: [] });
    await act(async () => { await client.invalidateQueries({ queryKey: keys.map('m2') }); });
    await waitFor(() => expect(lastEntries().map((e) => e.layer.id)).toEqual(['a', 'b']));
    expect(getMyMaps().expanded.has('m2')).toBe(false);
    expect(getMyMaps().expanded.has('m1')).toBe(true);
    expect(getToasts().map((t) => t.title)).toEqual(['Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.']);
    await waitFor(() => expect(client.getQueryData<{ sharedWithMe: unknown[] }>(keys.maps)?.sharedWithMe).toEqual([]));
  });

  it("another 404 (not the map's own) does not drop the map", async () => {
    expandMap('m2');
    const { client } = setup();
    await waitFor(() => expect(lastEntries().map((e) => e.layer.id)).toEqual(['c']));
    getMap.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy lớp.'));
    await act(async () => { await client.invalidateQueries({ queryKey: keys.map('m2') }); });
    expect(getMyMaps().expanded.has('m2')).toBe(true);
    expect(getToasts()).toEqual([]);
  });

  it('a 404 from a layer read (onMapGone) drops the map the same way', async () => {
    expandMap('m2');
    setup();
    await waitFor(() => expect(lastEntries().map((e) => e.layer.id)).toEqual(['c']));
    listMaps.mockResolvedValue({ mine: [summary('m1', 'owner'), summary('m3', 'owner')], sharedWithMe: [] });
    act(() => lastEntries()[0].onMapGone!('m2'));
    expect(getMyMaps().expanded.has('m2')).toBe(false);
    expect(getToasts().map((t) => t.title)).toEqual(['Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.']);
  });
});
