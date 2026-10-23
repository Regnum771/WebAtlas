import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportDialogView, type ExportDialogViewProps } from './ExportDialog.view';
import type { Job } from '../api/workspace.api';

const noop = vi.fn();
const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1', kind: 'export', status: 'succeeded', mapId: 'm1', progress: 100, steps: [], result: null, error: null,
  createdAt: '2026-10-23T00:00:00Z', finishedAt: '2026-10-23T00:01:00Z', ...over,
});
const props = (over: Partial<ExportDialogViewProps> = {}): ExportDialogViewProps => ({
  loading: false, format: 'gpkg', crs: 'wgs84-dd',
  layers: [{ id: 'l1', title: 'Cống', checked: true }],
  preview: null, previewError: null, warnings: [], job: null, error: null, queueing: false, canSubmit: true,
  files: [], listError: null, downloadingId: null, deletingId: null,
  onFormat: noop, onCrs: noop, onLayer: noop, onSubmit: noop, onDownload: noop, onDelete: noop, onClose: noop,
  ...over,
});

describe('ExportDialogView', () => {
  it('offers the three formats, the CRS aliases and the layers', () => {
    render(<ExportDialogView {...props()} />);
    expect(screen.getByRole('dialog', { name: 'Tải xuống bản đồ' })).toBeInTheDocument();
    const format = screen.getByLabelText('Định dạng');
    expect(within(format).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['GeoPackage (.gpkg)', 'GeoJSON', 'Shapefile nén (.zip)']);
    expect(screen.getByLabelText('Hệ toạ độ')).toHaveValue('wgs84-dd');
    expect(screen.getByRole('checkbox', { name: 'Cống' })).toBeChecked();
  });

  it('shows the cut field names and the warnings from the preview', () => {
    render(<ExportDialogView {...props({
      format: 'shp',
      preview: { layers: [{ layerId: 'l1', title: 'Cống', truncated: [{ from: 'ten_day_du_cua_truong', to: 'ten_day_du' }] }], warnings: [] },
      warnings: ['Tên trường bị cắt.'],
    })} />);
    expect(screen.getByRole('heading', { name: 'Tên trường sẽ đổi' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /ten_day_du_cua_truong/ });
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Cống', 'ten_day_du_cua_truong', 'ten_day_du']);
    expect(screen.getByText('Tên trường bị cắt.')).toBeInTheDocument();
  });

  it('hides the table when no name is cut', () => {
    render(<ExportDialogView {...props({ preview: { layers: [{ layerId: 'l1', title: 'Cống', truncated: [] }], warnings: [] } })} />);
    expect(screen.queryByText('Tên trường sẽ đổi')).toBeNull();
  });

  it('no layers disables Xuất', () => {
    render(<ExportDialogView {...props({ layers: [], canSubmit: false })} />);
    expect(screen.getByText('Không có lớp nào để xuất.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xuất' })).toBeDisabled();
  });

  it('Xuất submits, and Tải tệp appears once the job succeeded', async () => {
    const onSubmit = vi.fn();
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(<ExportDialogView {...props({ onSubmit, onDownload, job: job() })} />);
    await user.click(screen.getByRole('button', { name: 'Xuất' }));
    expect(onSubmit).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Tải tệp' }));
    expect(onDownload).toHaveBeenCalledWith('j1');
  });

  it('shows the progress of a running job and no Tải tệp', () => {
    render(<ExportDialogView {...props({ job: job({ status: 'running', progress: 40, finishedAt: null }) })} />);
    expect(screen.getByRole('progressbar', { name: 'Tiến độ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tải tệp' })).toBeNull();
  });

  it('shows the API error as it comes', () => {
    render(<ExportDialogView {...props({ error: 'Lớp quá lớn.' })} />);
    expect(screen.getByText('Lớp quá lớn.')).toBeInTheDocument();
  });
});
