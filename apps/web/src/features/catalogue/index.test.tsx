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
import { ApiError } from '../../shared/api/apiClient';

const file = (name: string) => new File(['x'], name);
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><TimeseriesUploadDialog onClose={vi.fn()} /></QueryClientProvider>);
}
const pick = (label: string, name: string) => userEvent.upload(screen.getByLabelText(label), file(name));

describe('TimeseriesUploadDialog', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); resetCatalogue(); });

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
    await waitFor(() => expect(h.createTimeseries).toHaveBeenCalledWith({ fileId: 'f1', title: 'Lũ', hdfArea: 'Area1', every: 1 }));
    expect(await screen.findByText('Đọc tệp')).toBeInTheDocument();
    await waitFor(() => expect(getCatalogue().map((l) => l.item.id)).toEqual(['r1']), { timeout: 5000 });
    expect(h.getCatalogueItem).toHaveBeenCalledWith('r1');
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

  it('shows the API refusal, e.g. no SSO', async () => {
    h.uploadCatalogueFile.mockRejectedValue(new ApiError(409, 'NEEDS_SSO', 'Cần đăng nhập một lần (SSO) để đưa dữ liệu lên Danh mục.'));
    setup();
    await pick('Tệp dữ liệu', 'a.zip');
    await userEvent.type(screen.getByLabelText('Tiêu đề'), 'Mưa');
    await userEvent.click(screen.getByRole('button', { name: 'Tải lên' }));
    expect(await screen.findByText('Cần đăng nhập một lần (SSO) để đưa dữ liệu lên Danh mục.')).toBeInTheDocument();
  });
});
