import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const listMaps = vi.fn();
const getMap = vi.fn();
const createMap = vi.fn();
const queueImport = vi.fn();
const getJob = vi.fn();
const listFeatures = vi.fn();
const listUploads = vi.fn();
vi.mock('../api/workspace.api', () => ({
  listMaps: () => listMaps(),
  getMap: (id: string) => getMap(id),
  createMap: (i: unknown) => createMap(i),
  queueImport: (id: string, i: unknown) => queueImport(id, i),
  getJob: (id: string) => getJob(id),
  listFeatures: (...a: unknown[]) => listFeatures(...a),
  listUploads: () => listUploads(),
}));
const uploadFile = vi.fn();
vi.mock('../api/transfer', () => ({
  uploadFile: (f: File, p: (n: number) => void, s: AbortSignal) => uploadFile(f, p, s),
}));
const fitToExtent4326 = vi.fn();
vi.mock('./personalLayers', () => ({
  fitToExtent4326: (...a: unknown[]) => fitToExtent4326(...a),
  refreshPersonalLayer: vi.fn(),
}));
const MAP = { tag: 'ol-map' };
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => ({ map: MAP }) }));

import { ApiError } from '../../../shared/api/apiClient';
import { useUploadPresenter, NEW_MAP } from './useUploadPresenter';
import { getMyMaps, resetMyMapsStore } from './myMaps.store';
import { getPendingImports, resetPendingImports } from './pendingImports.store';
import { usePendingImportPresenter } from './usePendingImportPresenter';
import { keys } from './queries';
import { getToasts, resetToasts } from '../../../shared/ui/toast.store';

const NO_CRS = 'Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn.';
const MINE = {
  id: 'm1', title: 'Lũ Đà Nẵng', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 3,
  updatedAt: '2026-10-01T00:00:00Z', layerCount: 0, role: 'owner' as const,
};
const job = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'import', status, mapId: 'm1', progress: 0, steps: [], result: null, error: null,
  createdAt: '2026-10-23T00:00:00Z', finishedAt: null, ...over,
});
const layer = (over: Record<string, unknown>) => ({
  id: 'l', kind: 'free', title: 'Lớp', position: 0, style: {}, geometryType: 'point', fields: [],
  layerKey: null, draftId: null, featureCount: 1, raster: null, ...over,
});

function setup(targetMapId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper, ...renderHook(() => useUploadPresenter({ targetMapId }), { wrapper }) };
}

/** Uploads a file into m1, waits for its import to run, then closes and unmounts the dialog. */
async function closeWhileRunning() {
  const s = setup('m1');
  act(() => s.result.current.setFile(new File(['x'], 'a.gpkg')));
  await act(async () => { await s.result.current.submit(); });
  await waitFor(() => expect(s.result.current.phase).toBe('running'));
  act(() => s.result.current.close());
  s.unmount();
  return s;
}

/** An upload that never finishes by itself and rejects with ABORTED when its signal fires. */
function pendingUpload() {
  uploadFile.mockImplementation((_f: File, onProgress: (n: number) => void, signal: AbortSignal) => {
    onProgress(0.42);
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new ApiError(0, 'ABORTED', 'Đã huỷ tải lên.')));
    });
  });
}

beforeEach(() => {
  [listMaps, getMap, createMap, queueImport, getJob, listFeatures, listUploads, uploadFile, fitToExtent4326]
    .forEach((m) => m.mockReset());
  resetMyMapsStore();
  resetPendingImports();
  resetToasts();
  listMaps.mockResolvedValue({ mine: [MINE], sharedWithMe: [] });
  listUploads.mockResolvedValue({ uploads: [], usageBytes: 0, quotaBytes: 1 });
  getMap.mockResolvedValue({ ...MINE, layers: [] });
  uploadFile.mockResolvedValue({ id: 'u1', originalName: 'x', sizeBytes: 1, createdAt: '' });
  queueImport.mockResolvedValue({ job: job('j1', 'queued') });
  getJob.mockResolvedValue(job('j1', 'running'));
});

describe('useUploadPresenter', () => {
  it('closing the dialog mid-upload aborts it and queues nothing', async () => {
    pendingUpload();
    const { result } = setup('m1');
    act(() => result.current.setFile(new File(['x'], 'song.zip')));
    let submitted!: Promise<void>;
    act(() => { submitted = result.current.submit(); });
    await waitFor(() => expect(result.current.phase).toBe('uploading'));
    expect(result.current.progress).toBe(42);
    const signal = uploadFile.mock.calls[0][2] as AbortSignal;
    act(() => result.current.close());
    await act(async () => { await submitted; });
    expect(signal.aborted).toBe(true);
    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(queueImport).not.toHaveBeenCalled();
    expect(createMap).not.toHaveBeenCalled();
  });

  it('a NO_CRS failure retries with the chosen CRS on the same file', async () => {
    queueImport
      .mockResolvedValueOnce({ job: job('j1', 'queued') })
      .mockResolvedValueOnce({ job: job('j2', 'queued') });
    getJob.mockImplementation(async (id: string) =>
      id === 'j1' ? job('j1', 'failed', { error: NO_CRS }) : job('j2', 'running'));
    const { result } = setup('m1');
    act(() => result.current.setFile(new File(['x'], 'kenh.zip')));
    await act(async () => { await result.current.submit(); });
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toBe(NO_CRS);
    await waitFor(() => expect(result.current.crsRequired).toBe(true));
    expect(result.current.canRetry).toBe(false); // no CRS chosen yet
    act(() => result.current.setSourceCrs('vn2000-tm3-da-nang'));
    expect(result.current.canRetry).toBe(true);
    await act(async () => { await result.current.retry('vn2000-tm3-da-nang'); });
    await waitFor(() => expect(result.current.phase).toBe('running'));
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(queueImport).toHaveBeenCalledTimes(2);
    expect(queueImport.mock.calls[0]).toEqual(['m1', { fileId: 'u1' }]);
    expect(queueImport.mock.calls[1]).toEqual(['m1', { fileId: 'u1', sourceCrs: 'vn2000-tm3-da-nang' }]);
    // The coordinate system stays required for this file.
    expect(result.current.crsRequired).toBe(true);
  });

  it('Bản đồ mới creates a map named after the file', async () => {
    createMap.mockResolvedValue({ ...MINE, id: 'm9', title: 'Cống thoát nước', layers: [] });
    const { result } = setup(null);
    expect(result.current.target).toBe(NEW_MAP);
    act(() => result.current.setFile(new File(['x'], 'Cống thoát nước.geojson')));
    await act(async () => { await result.current.submit(); });
    expect(createMap).toHaveBeenCalledWith({ title: 'Cống thoát nước' });
    // The map is made after the upload, just before the import is queued.
    expect(uploadFile.mock.invocationCallOrder[0]).toBeLessThan(createMap.mock.invocationCallOrder[0]);
    expect(createMap.mock.invocationCallOrder[0]).toBeLessThan(queueImport.mock.invocationCallOrder[0]);
    expect(queueImport).toHaveBeenCalledWith('m9', { fileId: 'u1' });
  });

  it('opened from a map card, that map is preselected', async () => {
    const { result } = setup('m1');
    expect(result.current.target).toBe('m1');
    await waitFor(() => expect(result.current.targets).toEqual([{ id: 'm1', title: 'Lũ Đà Nẵng' }]));
  });

  it('a file over 200 MB is refused before sending', async () => {
    const big = new File(['x'], 'anh.tif');
    Object.defineProperty(big, 'size', { value: 200 * 1024 * 1024 + 1 });
    const { result } = setup('m1');
    act(() => result.current.setFile(big));
    expect(result.current.fileError).toBe('Tệp lớn hơn 200 MB.');
    expect(result.current.canSubmit).toBe(false);
    await act(async () => { await result.current.submit(); });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(queueImport).not.toHaveBeenCalled();
  });

  it('an API refusal shows its message and queues nothing', async () => {
    uploadFile.mockRejectedValue(new ApiError(413, 'QUOTA_EXCEEDED', 'Đã hết dung lượng lưu trữ.'));
    const { result } = setup('m1');
    act(() => result.current.setFile(new File(['x'], 'a.gpkg')));
    await act(async () => { await result.current.submit(); });
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('Đã hết dung lượng lưu trữ.');
    expect(queueImport).not.toHaveBeenCalled();
  });

  it('unmounting mid-upload aborts it', async () => {
    pendingUpload();
    const { result, unmount } = setup('m1');
    act(() => result.current.setFile(new File(['x'], 'song.zip')));
    act(() => { void result.current.submit(); });
    await waitFor(() => expect(uploadFile).toHaveBeenCalled());
    const signal = uploadFile.mock.calls[0][2] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(queueImport).not.toHaveBeenCalled();
  });

  it('an import that failed to queue is queued again without a second upload', async () => {
    queueImport
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Network request failed'))
      .mockResolvedValueOnce({ job: job('j1', 'queued') });
    const { result } = setup('m1');
    act(() => result.current.setFile(new File(['x'], 'a.gpkg')));
    await act(async () => { await result.current.submit(); });
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('Network request failed');
    await act(async () => { await result.current.submit(); });
    await waitFor(() => expect(result.current.phase).toBe('running'));
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(queueImport).toHaveBeenCalledTimes(2);
    expect(queueImport.mock.calls[1]).toEqual(['m1', { fileId: 'u1' }]);
  });

  it('success turns on the new layers', async () => {
    getJob.mockResolvedValue(job('j1', 'succeeded', { result: { layerIds: ['l9', 'l10'], rows: 12 } }));
    getMap.mockResolvedValue({
      ...MINE,
      layers: [
        layer({ id: 'l9', kind: 'free' }),
        layer({ id: 'l10', kind: 'raster', geometryType: null, raster: { bounds4326: [106, 14, 107.5, 15.5] } }),
      ],
    });
    listFeatures.mockResolvedValue({
      type: 'FeatureCollection', truncated: false,
      features: [
        { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [108.2, 16.05] }, properties: {} },
        { type: 'Feature', id: 'b', geometry: { type: 'LineString', coordinates: [[108.1, 16.0], [108.3, 16.2]] }, properties: {} },
        { type: 'Feature', id: 'c', geometry: null, properties: {} },
      ],
    });
    const { result } = setup('m1');
    act(() => result.current.setFile(new File(['x'], 'a.gpkg')));
    await act(async () => { await result.current.submit(); });
    await waitFor(() => expect(result.current.phase).toBe('succeeded'));
    expect(result.current.successText).toBe('Đã nhập xong. 12 đối tượng.');
    await waitFor(() => expect(fitToExtent4326).toHaveBeenCalled());
    expect(getMyMaps().expanded.has('m1')).toBe(true);
    expect(getMyMaps().layers.l9?.visible).toBe(true);
    expect(getMyMaps().layers.l10?.visible).toBe(true);
    expect(listFeatures).toHaveBeenCalledTimes(1);
    expect(listFeatures).toHaveBeenCalledWith('m1', 'l9', { bbox: [-180, -90, 180, 90], limit: 5000 });
    expect(fitToExtent4326).toHaveBeenCalledWith(MAP, [106, 14, 108.3, 16.2]);
  });

  it('a success with no rows says only Đã nhập xong.', async () => {
    getJob.mockResolvedValue(job('j1', 'succeeded', { result: { layerIds: [], rows: 0 } }));
    const { result } = setup('m1');
    act(() => result.current.setFile(new File(['x'], 'a.gpkg')));
    await act(async () => { await result.current.submit(); });
    await waitFor(() => expect(result.current.successText).toBe('Đã nhập xong.'));
  });

  it('closing during running still refreshes the map and turns the new layers on when the job succeeds', async () => {
    const { client, wrapper } = await closeWhileRunning();
    expect(getPendingImports()).toEqual([{ jobId: 'j1', mapId: 'm1' }]);
    const entry = getPendingImports()[0];
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    getJob.mockResolvedValue(job('j1', 'succeeded', { result: { layerIds: ['l9', 'l10'], rows: 12 } }));
    renderHook(() => usePendingImportPresenter(entry), { wrapper });
    await waitFor(() => expect(getPendingImports()).toEqual([]));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.maps });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.map('m1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.uploads });
    expect(getMyMaps().expanded.has('m1')).toBe(true);
    expect(getMyMaps().layers.l9?.visible).toBe(true);
    expect(getMyMaps().layers.l10?.visible).toBe(true);
    expect(getToasts().map((t) => [t.tone, t.title])).toEqual([['success', 'Đã nhập xong. 12 đối tượng.']]);
  });

  it('closing during running shows the job error as a toast when it fails', async () => {
    const { wrapper } = await closeWhileRunning();
    const entry = getPendingImports()[0];
    getJob.mockResolvedValue(job('j1', 'failed', { error: NO_CRS }));
    renderHook(() => usePendingImportPresenter(entry), { wrapper });
    await waitFor(() => expect(getPendingImports()).toEqual([]));
    expect(getToasts().map((t) => [t.tone, t.title])).toEqual([['error', NO_CRS]]);
    expect(getMyMaps().expanded.has('m1')).toBe(false);
  });

  it('closing after the import ended hands nothing off', async () => {
    getJob.mockResolvedValue(job('j1', 'succeeded', { result: { layerIds: [], rows: 0 } }));
    const { result } = setup('m1');
    act(() => result.current.setFile(new File(['x'], 'a.gpkg')));
    await act(async () => { await result.current.submit(); });
    await waitFor(() => expect(result.current.phase).toBe('succeeded'));
    act(() => result.current.close());
    expect(getPendingImports()).toEqual([]);
  });

  it('the GeoJSON CRS warning shows only for a .geojson with a non-WGS 84 choice', () => {
    const { result } = setup('m1');
    act(() => result.current.setFile(new File(['x'], 'diem.geojson')));
    expect(result.current.crsWarning).toBe(false);
    act(() => result.current.setSourceCrs('wgs84-dd'));
    expect(result.current.crsWarning).toBe(false);
    act(() => result.current.setSourceCrs('wgs84-dms'));
    expect(result.current.crsWarning).toBe(false);
    act(() => result.current.setSourceCrs('vn2000-utm48'));
    expect(result.current.crsWarning).toBe(true);
    act(() => result.current.setFile(new File(['x'], 'DIEM.JSON')));
    expect(result.current.crsWarning).toBe(true);
    act(() => result.current.setFile(new File(['x'], 'diem.zip')));
    expect(result.current.crsWarning).toBe(false);
  });
});
