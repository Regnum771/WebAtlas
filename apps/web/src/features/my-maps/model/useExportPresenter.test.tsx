import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const getMap = vi.fn();
const previewExport = vi.fn();
const queueExport = vi.fn();
const getJob = vi.fn();
const listJobs = vi.fn();
const deleteJob = vi.fn();
const listUploads = vi.fn();
vi.mock('../api/workspace.api', () => ({
  getMap: (id: string) => getMap(id),
  previewExport: (...a: unknown[]) => previewExport(...a),
  queueExport: (...a: unknown[]) => queueExport(...a),
  getJob: (id: string) => getJob(id),
  listJobs: (q: unknown) => listJobs(q),
  deleteJob: (id: string) => deleteJob(id),
  listUploads: () => listUploads(),
}));
const downloadJobFile = vi.fn();
const saveBlob = vi.fn();
vi.mock('../api/transfer', () => ({
  downloadJobFile: (id: string) => downloadJobFile(id),
  saveBlob: (...a: unknown[]) => saveBlob(...a),
}));

import { useExportPresenter } from './useExportPresenter';

const layer = (over: Record<string, unknown>) => ({
  id: 'l1', kind: 'free', title: 'Cống', position: 0, style: {}, geometryType: 'point', fields: [],
  layerKey: null, draftId: null, featureCount: 3, raster: null, ...over,
});
const MAP = {
  id: 'm1', title: 'Lũ', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 1,
  updatedAt: '', layerCount: 3, role: 'owner',
  layers: [layer({ id: 'l1' }), layer({ id: 'l2', title: 'Sông', position: 1 }), layer({ id: 'r1', kind: 'raster', title: 'Ảnh', position: 2 })],
};
const job = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'export', status, mapId: 'm1', progress: 0, steps: [], result: null, error: null,
  createdAt: '2026-10-23T00:00:00Z', finishedAt: null, ...over,
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useExportPresenter({ mapId: 'm1' }), { wrapper }), invalidate };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  [getMap, previewExport, queueExport, getJob, listJobs, deleteJob, listUploads, downloadJobFile, saveBlob]
    .forEach((m) => m.mockReset());
  getMap.mockResolvedValue(MAP);
  previewExport.mockResolvedValue({ layers: [], warnings: [] });
  listJobs.mockResolvedValue([]);
  listUploads.mockResolvedValue({ uploads: [], usageBytes: 0, quotaBytes: 1 });
});
afterEach(() => { vi.useRealTimers(); });

describe('useExportPresenter', () => {
  it('lists the non-raster layers, all checked, with the default format and CRS', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.layers).toHaveLength(2));
    expect(result.current.layers.every((l) => l.checked)).toBe(true);
    expect(result.current.format).toBe('gpkg');
    expect(result.current.crs).toBe('wgs84-dd');
  });

  it('the preview lists cut Shapefile names and the API warnings', async () => {
    previewExport.mockResolvedValue({
      layers: [{ layerId: 'l1', title: 'Cống', truncated: [{ from: 'ten_day_du_cua_truong', to: 'ten_day_du' }] }],
      warnings: ['Tên trường bị cắt.'],
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.layers).toHaveLength(2));
    act(() => result.current.setFormat('shp'));
    // Not before the 300 ms debounce has passed.
    expect(previewExport).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(previewExport).toHaveBeenCalledTimes(1);
    expect(previewExport).toHaveBeenCalledWith('m1', { format: 'shp', crs: 'wgs84-dd', layerIds: ['l1', 'l2'] });
    expect(result.current.preview?.layers[0].truncated).toEqual([{ from: 'ten_day_du_cua_truong', to: 'ten_day_du' }]);
    expect(result.current.warnings).toEqual(['Tên trường bị cắt.']);
  });

  it('several quick changes make one preview request', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.layers).toHaveLength(2));
    act(() => result.current.setFormat('shp'));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    act(() => result.current.toggleLayer('l2', false));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(previewExport).toHaveBeenCalledTimes(1);
    expect(previewExport).toHaveBeenCalledWith('m1', { format: 'shp', crs: 'wgs84-dd', layerIds: ['l1'] });
  });

  it('no layers checked: no preview, and the export cannot be queued', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.layers).toHaveLength(2));
    act(() => { result.current.toggleLayer('l1', false); result.current.toggleLayer('l2', false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(previewExport).not.toHaveBeenCalled();
    expect(result.current.canSubmit).toBe(false);
  });

  it('Tải tệp downloads with the token, not a plain link', async () => {
    queueExport.mockResolvedValue({ job: job('j1', 'queued'), warnings: [] });
    getJob.mockResolvedValue(job('j1', 'succeeded', { finishedAt: '2026-10-23T00:01:00Z' }));
    const blob = new Blob(['x']);
    downloadJobFile.mockResolvedValue({ blob, filename: 'lu.gpkg' });
    const { result } = setup();
    await waitFor(() => expect(result.current.layers).toHaveLength(2));
    await act(async () => { await result.current.submit(); });
    expect(queueExport).toHaveBeenCalledWith('m1', { format: 'gpkg', crs: 'wgs84-dd', layerIds: ['l1', 'l2'] });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await waitFor(() => expect(result.current.job?.status).toBe('succeeded'));
    await act(async () => { await result.current.download('j1'); });
    expect(downloadJobFile).toHaveBeenCalledWith('j1');
    expect(saveBlob).toHaveBeenCalledWith(blob, 'lu.gpkg');
  });

  it('Xoá removes the row and refreshes the quota', async () => {
    listJobs.mockResolvedValueOnce([job('j1', 'succeeded', { finishedAt: '2026-10-23T00:01:00Z' })]).mockResolvedValue([]);
    deleteJob.mockResolvedValue(undefined);
    const { result, invalidate } = setup();
    await waitFor(() => expect(result.current.files).toHaveLength(1));
    await act(async () => { await result.current.remove('j1'); });
    expect(deleteJob).toHaveBeenCalledWith('j1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ws', 'uploads'] });
    await waitFor(() => expect(result.current.files).toHaveLength(0));
  });

  it('a refused delete shows the API message and keeps the row', async () => {
    listJobs.mockResolvedValue([job('j1', 'running')]);
    deleteJob.mockRejectedValue(new Error('Công việc đang chạy, chưa xoá được.'));
    const { result } = setup();
    await waitFor(() => expect(result.current.files).toHaveLength(1));
    await act(async () => { await result.current.remove('j1'); });
    expect(result.current.listError).toBe('Công việc đang chạy, chưa xoá được.');
    expect(result.current.files).toHaveLength(1);
  });
});
