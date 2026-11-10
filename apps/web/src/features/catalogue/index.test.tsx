import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  uploadCatalogueFile: vi.fn(), createTimeseries: vi.fn(), getCatalogueItem: vi.fn(), getJob: vi.fn(),
}));
vi.mock('./api/catalogue.api', async (orig) => ({
  ...(await orig<typeof import('./api/catalogue.api')>()),
  uploadCatalogueFile: h.uploadCatalogueFile, createTimeseries: h.createTimeseries, getCatalogueItem: h.getCatalogueItem,
}));
vi.mock('../my-maps/api/workspace.api', async (orig) => ({
  ...(await orig<typeof import('../my-maps/api/workspace.api')>()), getJob: h.getJob,
}));

import { TimeseriesUploadDialog } from './index';
import { getCatalogue, resetCatalogue } from './model/catalogue.store';
import { resetFollowedJobs } from './model/timeseriesJobFollower';
import { ApiError } from '../../shared/api/apiClient';
import { getToasts, resetToasts } from '../../shared/ui/toast.store';
import type { Clip4326 } from './api/catalogue.api';

const file = (name: string) => new File(['x'], name);
function setup(viewExtent4326?: () => Clip4326 | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><TimeseriesUploadDialog onClose={vi.fn()} viewExtent4326={viewExtent4326} /></QueryClientProvider>,
  );
}
const pick = (label: string, name: string) => userEvent.upload(screen.getByLabelText(label), file(name));

describe('TimeseriesUploadDialog', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); resetCatalogue(); resetFollowedJobs(); resetToasts(); });

  it('requires a title', async () => {
    setup();
    await pick('Tệp dữ liệu', 'mua.zip');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    expect(screen.getByText('Nhập tiêu đề.')).toBeInTheDocument();
    expect(h.uploadCatalogueFile).not.toHaveBeenCalled();
  });

  it('shows the pattern select only for .zip/.tif, area and 15-minute only for .hdf', async () => {
    setup();
    expect(screen.queryByLabelText('Mẫu thời gian trong tên tệp')).toBeNull();
    await pick('Tệp dữ liệu', 'a.tif');
    expect(screen.getByLabelText('Mẫu thời gian trong tên tệp')).toBeInTheDocument();
    expect(screen.queryByLabelText('Vùng 2D (để trống nếu chỉ có một)')).toBeNull();
    expect(screen.queryByLabelText('Mỗi 15 phút')).toBeNull();
    await pick('Tệp dữ liệu', 'a.hdf');
    expect(screen.queryByLabelText('Mẫu thời gian trong tên tệp')).toBeNull();
    expect(screen.getByLabelText('Vùng 2D (để trống nếu chỉ có một)')).toBeInTheDocument();
    expect(screen.getByLabelText('Mỗi 15 phút')).not.toBeChecked();
    await pick('Tệp dữ liệu', 'a.nc');
    expect(screen.queryByLabelText('Vùng 2D (để trống nếu chỉ có một)')).toBeNull();
  });

  it('uploads, queues the job with the chosen options, shows progress, then adds the new layer', async () => {
    h.uploadCatalogueFile.mockResolvedValueOnce({ id: 'f1', originalName: 'a.hdf', sizeBytes: 1 });
    h.createTimeseries.mockResolvedValue({ job: { id: 'j1' } });
    const running = { id: 'j1', status: 'running', progress: 40, steps: [{ key: 's', label: 'Đọc tệp', status: 'running' }], result: null, error: null };
    h.getJob.mockResolvedValueOnce(running).mockResolvedValue({
      ...running, status: 'succeeded', progress: 100, result: { resourceId: 'r1', alternate: 'geonode:x', steps: 5 },
    });
    h.getCatalogueItem.mockResolvedValue({ id: 'r1', kind: 'timeseries', title: 'Lũ', layerName: 'geonode:x', timeSteps: [] });
    setup();
    await pick('Tệp dữ liệu', 'a.hdf');
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Lũ');
    await userEvent.type(screen.getByLabelText('Vùng 2D (để trống nếu chỉ có một)'), 'Area1');
    await userEvent.click(screen.getByLabelText('Mỗi 15 phút'));
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    await waitFor(() => expect(h.createTimeseries).toHaveBeenCalledWith({
      fileId: 'f1', title: 'Lũ', hdfArea: 'Area1', every: 1, hdfTimeZone: 'Asia/Ho_Chi_Minh',
    }));
    expect(await screen.findByText('Đọc tệp')).toBeInTheDocument();
    await waitFor(() => expect(getCatalogue().map((l) => l.item.id)).toEqual(['r1']), { timeout: 5000 });
    expect(h.getCatalogueItem).toHaveBeenCalledWith('r1');
    expect(await screen.findByText('Đã thêm chuỗi thời gian vào bản đồ.')).toBeInTheDocument();
  });

  it('the CSV time option uploads the csv first and passes timesCsvFileId', async () => {
    h.uploadCatalogueFile
      .mockResolvedValueOnce({ id: 'f1', originalName: 'a.zip', sizeBytes: 1 })
      .mockResolvedValueOnce({ id: 'c1', originalName: 't.csv', sizeBytes: 1 });
    h.createTimeseries.mockResolvedValue({ job: { id: 'j1' } });
    h.getJob.mockResolvedValue({ id: 'j1', status: 'running', progress: 0, steps: [], result: null, error: null });
    setup();
    await pick('Tệp dữ liệu', 'a.zip');
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Mưa');
    await userEvent.selectOptions(screen.getByLabelText('Mẫu thời gian trong tên tệp'), 'Tệp CSV thời điểm');
    await pick('Tệp CSV thời điểm', 't.csv');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    await waitFor(() => expect(h.createTimeseries).toHaveBeenCalledWith({ fileId: 'f1', title: 'Mưa', timesCsvFileId: 'c1' }));
  });

  it('I2: a retry with the same file reuses the upload; another file is uploaded', async () => {
    h.uploadCatalogueFile.mockResolvedValueOnce({ id: 'f1', originalName: 'a.zip', sizeBytes: 1 })
      .mockResolvedValueOnce({ id: 'f2', originalName: 'b.zip', sizeBytes: 1 });
    h.createTimeseries.mockResolvedValueOnce({ job: { id: 'j1' } }).mockResolvedValue({ job: { id: 'j2' } });
    h.getJob.mockResolvedValue({ id: 'j1', status: 'failed', progress: 0, steps: [], result: null, error: 'Mẫu thời gian không khớp.' });
    setup();
    await pick('Tệp dữ liệu', 'a.zip');
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Mưa');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    expect(await screen.findByText('Mẫu thời gian không khớp.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    await waitFor(() => expect(h.createTimeseries).toHaveBeenCalledTimes(2));
    expect(h.uploadCatalogueFile).toHaveBeenCalledTimes(1);
    expect(h.createTimeseries.mock.calls[1][0]).toMatchObject({ fileId: 'f1' });
    // A different File object is a new upload.
    await pick('Tệp dữ liệu', 'b.zip');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    await waitFor(() => expect(h.createTimeseries).toHaveBeenCalledTimes(3));
    expect(h.uploadCatalogueFile).toHaveBeenCalledTimes(2);
    expect(h.createTimeseries.mock.calls[2][0]).toMatchObject({ fileId: 'f2' });
  });

  it('I5: a NetCDF upload is cut to the map view by default; unticking sends no extent', async () => {
    h.uploadCatalogueFile.mockResolvedValue({ id: 'f1', originalName: 'm.nc', sizeBytes: 1 });
    h.createTimeseries.mockRejectedValueOnce(new ApiError(400, 'X', 'thử lại')).mockResolvedValue({ job: { id: 'j1' } });
    h.getJob.mockResolvedValue({ id: 'j1', status: 'running', progress: 0, steps: [], result: null, error: null });
    setup(() => [107.2, 14.8, 108.9, 16.2]);
    await pick('Tệp dữ liệu', 'm.nc');
    const box = screen.getByLabelText('Cắt theo khung bản đồ hiện tại');
    expect(box).toBeChecked();
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Mưa');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    await waitFor(() => expect(h.createTimeseries).toHaveBeenCalledWith({ fileId: 'f1', title: 'Mưa', clip4326: [107.2, 14.8, 108.9, 16.2] }));
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    await waitFor(() => expect(h.createTimeseries).toHaveBeenLastCalledWith({ fileId: 'f1', title: 'Mưa' }));
  });

  it('I5/I6: the clip box shows for .nc and .zip, the clock choice for .hdf only', async () => {
    setup(() => [0, 0, 1, 1]);
    await pick('Tệp dữ liệu', 'a.zip');
    expect(screen.getByLabelText('Cắt theo khung bản đồ hiện tại')).toBeInTheDocument();
    expect(screen.queryByLabelText('Giờ Việt Nam (UTC+7)')).toBeNull();
    await pick('Tệp dữ liệu', 'a.tif');
    expect(screen.queryByLabelText('Cắt theo khung bản đồ hiện tại')).toBeNull();
    await pick('Tệp dữ liệu', 'a.hdf');
    expect(screen.queryByLabelText('Cắt theo khung bản đồ hiện tại')).toBeNull();
    expect(screen.getByLabelText('Giờ Việt Nam (UTC+7)')).toBeChecked();
    expect(screen.getByLabelText('UTC')).not.toBeChecked();
  });

  it('I6: choosing UTC for a .hdf sends hdfTimeZone UTC', async () => {
    h.uploadCatalogueFile.mockResolvedValue({ id: 'f1', originalName: 'a.hdf', sizeBytes: 1 });
    h.createTimeseries.mockResolvedValue({ job: { id: 'j1' } });
    h.getJob.mockResolvedValue({ id: 'j1', status: 'running', progress: 0, steps: [], result: null, error: null });
    setup();
    await pick('Tệp dữ liệu', 'a.hdf');
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Lũ');
    await userEvent.click(screen.getByLabelText('UTC'));
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    await waitFor(() => expect(h.createTimeseries).toHaveBeenCalledWith({ fileId: 'f1', title: 'Lũ', every: 4, hdfTimeZone: 'UTC' }));
  });

  it('M14: closing the dialog aborts the upload in flight', async () => {
    let signal: AbortSignal | undefined;
    h.uploadCatalogueFile.mockImplementation((_f: File, s?: AbortSignal) => {
      signal = s;
      return new Promise((_resolve, reject) => s?.addEventListener('abort', () => reject(new ApiError(0, 'ABORTED', 'Đã huỷ.'))));
    });
    const { unmount } = setup();
    await pick('Tệp dữ liệu', 'a.zip');
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Mưa');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal!.aborted).toBe(false);
    unmount();
    expect(signal!.aborted).toBe(true);
    expect(h.createTimeseries).not.toHaveBeenCalled();
  });

  it('M14: a job still running when the dialog closes is followed and its entry put on the map', async () => {
    h.uploadCatalogueFile.mockResolvedValue({ id: 'f1', originalName: 'a.zip', sizeBytes: 1 });
    h.createTimeseries.mockResolvedValue({ job: { id: 'j1' } });
    h.getJob.mockResolvedValue({ id: 'j1', status: 'running', progress: 10, steps: [{ key: 's', label: 'Đọc tệp', status: 'running' }], result: null, error: null });
    h.getCatalogueItem.mockResolvedValue({ id: 'r1', kind: 'timeseries', title: 'Mưa', layerName: 'geonode:x', timeSteps: [] });
    const { unmount } = setup();
    await pick('Tệp dữ liệu', 'a.zip');
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Mưa');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    expect(await screen.findByText('Đọc tệp')).toBeInTheDocument();
    h.getJob.mockResolvedValue({ id: 'j1', status: 'succeeded', progress: 100, steps: [], result: { resourceId: 'r1' }, error: null });
    unmount();
    await waitFor(() => expect(getCatalogue().map((l) => l.item.id)).toEqual(['r1']), { timeout: 5000 });
    expect(getToasts().at(-1)?.title).toBe('Đã thêm “Mưa” vào bản đồ.');
  });

  it('shows the API refusal, e.g. no SSO', async () => {
    h.uploadCatalogueFile.mockRejectedValue(new ApiError(409, 'NEEDS_SSO', 'Cần đăng nhập một lần (SSO) để đưa dữ liệu lên Danh mục.'));
    setup();
    await pick('Tệp dữ liệu', 'a.zip');
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Mưa');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    expect(await screen.findByText('Cần đăng nhập một lần (SSO) để đưa dữ liệu lên Danh mục.')).toBeInTheDocument();
  });

  it('shows the API message on a 413 and keeps Huỷ a non-submitting button', async () => {
    h.uploadCatalogueFile.mockRejectedValue(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Tệp lớn hơn 2 GB.'));
    setup();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toHaveAttribute('type', 'button');
    await pick('Tệp dữ liệu', 'a.zip');
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Mưa');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    expect(await screen.findByText('Tệp lớn hơn 2 GB.')).toBeInTheDocument();
  });

  it('shows the success message only once the layer was added', async () => {
    h.uploadCatalogueFile.mockResolvedValueOnce({ id: 'f1', originalName: 'a.zip', sizeBytes: 1 });
    h.createTimeseries.mockResolvedValue({ job: { id: 'j1' } });
    h.getJob.mockResolvedValue({
      id: 'j1', status: 'succeeded', progress: 100, steps: [], result: { resourceId: 'r1', alternate: 'x', steps: 2 }, error: null,
    });
    h.getCatalogueItem.mockRejectedValue(new ApiError(500, 'X', 'boom'));
    setup();
    await pick('Tệp dữ liệu', 'a.zip');
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Mưa');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    expect(await screen.findByText('Đã xử lý xong nhưng chưa mở được mục trong Danh mục.')).toBeInTheDocument();
    expect(screen.queryByText('Đã thêm chuỗi thời gian vào bản đồ.')).toBeNull();
    expect(getCatalogue()).toHaveLength(0);
  });
});
