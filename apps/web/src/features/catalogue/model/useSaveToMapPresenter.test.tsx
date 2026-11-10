import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const listMaps = vi.fn();
const getMap = vi.fn();
const addCatalogueLink = vi.fn();
const getJob = vi.fn();
vi.mock('../../my-maps/api/workspace.api', () => ({
  listMaps: () => listMaps(),
  getMap: (id: string) => getMap(id),
  addCatalogueLink: (...a: unknown[]) => addCatalogueLink(...a),
  getJob: (id: string) => getJob(id),
}));
const copyCatalogueItem = vi.fn();
vi.mock('../api/catalogue.api', () => ({ copyCatalogueItem: (...a: unknown[]) => copyCatalogueItem(...a) }));

import { ApiError } from '../../../shared/api/apiClient';
import { getToasts, resetToasts } from '../../../shared/ui/toast.store';
import { getMyMaps, resetMyMapsStore } from '../../my-maps/model/myMaps.store';
import { keys } from '../../my-maps/model/queries';
import type { CatalogueItem } from '../api/catalogue.api';
import { addCatalogueLayer, getCatalogue, resetCatalogue } from './catalogue.store';
import { useSaveToMapPresenter } from './useSaveToMapPresenter';

const map = (id: string, title: string, role: 'owner' | 'recipient') => ({
  id, title, description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 4, updatedAt: '', layerCount: 0, role,
});
const MINE = map('m1', 'Bản của tôi', 'owner');
const SHARED = map('m2', 'Được chia sẻ', 'recipient');
const ITEM: CatalogueItem = {
  id: 'r1', kind: 'vector', title: 'Trạm đo mưa', abstract: '', managingUnit: 'VN', isPublished: true, mine: false,
  variable: null, unit: null, timeSteps: null, bbox4326: null, layerName: 'geonode:r1',
};
const job = (status: string, over: Record<string, unknown> = {}) => ({
  id: 'j1', kind: 'import', status, mapId: 'm1', progress: status === 'succeeded' ? 100 : 10, steps: [],
  result: null, error: null, createdAt: '', finishedAt: null, ...over,
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, invalidate, ...renderHook(() => useSaveToMapPresenter({ enabled: true }), { wrapper }) };
}

beforeEach(() => {
  [listMaps, getMap, addCatalogueLink, getJob, copyCatalogueItem].forEach((m) => m.mockReset());
  resetMyMapsStore();
  resetCatalogue();
  resetToasts();
  listMaps.mockResolvedValue({ mine: [MINE], sharedWithMe: [SHARED] });
  getMap.mockResolvedValue({ ...MINE, layers: [] });
});

describe('useSaveToMapPresenter', () => {
  it('offers only the user\'s own maps, the first chosen', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.targets).toEqual([{ id: 'm1', title: 'Bản của tôi' }]));
    act(() => result.current.start('r1', 'link'));
    expect(result.current.open).toEqual({ itemId: 'r1', mode: 'link' });
    expect(result.current.target).toBe('m1');
  });

  it('Lưu vào bản đồ của tôi: a link at the map\'s revision; the layer moves into the map', async () => {
    addCatalogueLayer(ITEM);
    addCatalogueLink.mockResolvedValue({ layer: { id: 'c1' }, revision: 5 });
    const { result, invalidate } = setup();
    await waitFor(() => expect(result.current.targets).toHaveLength(1));
    act(() => result.current.start('r1', 'link'));
    await act(async () => { await result.current.submit(ITEM); });
    expect(addCatalogueLink).toHaveBeenCalledWith('m1', { resourceId: 'r1', expectedRevision: 4 });
    expect(getMyMaps().expanded.has('m1')).toBe(true);
    expect(getMyMaps().layers.c1).toEqual({ visible: true, opacity: 1 });
    // Drawn once, by the map, not also as a free-standing layer.
    expect(getCatalogue()).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.map('m1') });
    expect(getToasts().at(-1)?.title).toBe('Đã lưu “Trạm đo mưa” vào “Bản của tôi”.');
    expect(result.current.open).toBeNull();
  });

  it('an API refusal is shown verbatim and the layer stays', async () => {
    addCatalogueLayer(ITEM);
    addCatalogueLink.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy dữ liệu trong Danh mục.'));
    const { result } = setup();
    await waitFor(() => expect(result.current.targets).toHaveLength(1));
    act(() => result.current.start('r1', 'link'));
    await act(async () => { await result.current.submit(ITEM); });
    expect(result.current.error).toBe('Không tìm thấy dữ liệu trong Danh mục.');
    expect(getCatalogue()).toHaveLength(1);
  });

  it('Sao vào Bản của tôi: queues the copy, follows the job, then shows its layers in the map', async () => {
    copyCatalogueItem.mockResolvedValue({ job: job('queued') });
    getJob.mockResolvedValueOnce(job('running')).mockResolvedValue(job('succeeded', { result: { layerIds: ['n1'], rows: 1 } }));
    const { result, invalidate } = setup();
    await waitFor(() => expect(result.current.targets).toHaveLength(1));
    act(() => result.current.start('r1', 'copy'));
    await act(async () => { await result.current.submit(ITEM); });
    expect(copyCatalogueItem).toHaveBeenCalledWith('r1', 'm1');
    expect(result.current.job?.status).toBe('queued');
    expect(result.current.busy).toBe(true);
    await waitFor(() => expect(result.current.done).toBe('Đã sao vào “Bản của tôi”.'), { timeout: 4000 });
    expect(result.current.job?.status).toBe('succeeded');
    expect(result.current.busy).toBe(false);
    expect(getMyMaps().expanded.has('m1')).toBe(true);
    expect(getMyMaps().layers.n1).toEqual({ visible: true, opacity: 1 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.map('m1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.uploads });
  });

  it('a refused copy or a failed job shows the message verbatim', async () => {
    copyCatalogueItem.mockRejectedValueOnce(new ApiError(400, 'VALIDATION_ERROR', 'Mục này chỉ thêm được dạng liên kết.'));
    const { result } = setup();
    await waitFor(() => expect(result.current.targets).toHaveLength(1));
    act(() => result.current.start('r1', 'copy'));
    await act(async () => { await result.current.submit(ITEM); });
    expect(result.current.error).toBe('Mục này chỉ thêm được dạng liên kết.');

    copyCatalogueItem.mockResolvedValue({ job: job('queued') });
    getJob.mockResolvedValue(job('failed', { error: 'Tệp vượt quá 200000 đối tượng.' }));
    await act(async () => { await result.current.submit(ITEM); });
    await waitFor(() => expect(result.current.error).toBe('Tệp vượt quá 200000 đối tượng.'), { timeout: 4000 });
    expect(result.current.done).toBeNull();
  });
});
