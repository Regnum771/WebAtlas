import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CRS_OPTIONS } from '@webatlas/shared';
import { NEW_MAP } from '../model/useUploadPresenter';
import { UploadDialogView, type UploadDialogViewProps } from './UploadDialog.view';

const GEOJSON_WARNING = 'Tệp GeoJSON thường đã ở WGS 84. Chỉ chọn hệ khác nếu chắc chắn toạ độ trong tệp là toạ độ phẳng.';

const base = (over: Partial<UploadDialogViewProps> = {}): UploadDialogViewProps => ({
  phase: 'idle', progress: 0, job: null, fileName: null, fileError: null,
  target: NEW_MAP, targets: [{ id: 'm1', title: 'Lũ Đà Nẵng' }],
  sourceCrs: '', crsRequired: false, crsWarning: false, error: null, successText: null,
  canSubmit: false, canRetry: false,
  onFile: vi.fn(), onTarget: vi.fn(), onSourceCrs: vi.fn(), onSubmit: vi.fn(), onRetry: vi.fn(), onClose: vi.fn(),
  ...over,
});

describe('UploadDialogView', () => {
  it('shows the title, hint, file input, both selects and the buttons', () => {
    render(<UploadDialogView {...base()} />);
    expect(screen.getByRole('dialog', { name: 'Tải tệp lên' })).toBeInTheDocument();
    expect(screen.getByText('GeoPackage, GeoJSON, Shapefile nén (.zip), KML hoặc GeoTIFF; tối đa 200 MB.')).toBeInTheDocument();
    expect(screen.getByLabelText('Chọn tệp')).toHaveAttribute('accept', '.gpkg,.geojson,.json,.zip,.kml,.tif,.tiff');
    const target = screen.getByRole('combobox', { name: 'Nhập vào' });
    expect(within(target).getAllByRole('option').map((o) => o.textContent)).toEqual(['Bản đồ mới', 'Lũ Đà Nẵng']);
    expect(target).toHaveValue(NEW_MAP);
    const crs = screen.getByRole('combobox', { name: 'Hệ toạ độ nguồn' });
    expect(within(crs).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Theo tệp (tự nhận)', ...CRS_OPTIONS.map((o) => o.alias)]);
    expect(crs).not.toBeRequired();
    expect(screen.getByRole('button', { name: 'Tải lên và nhập' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nhập lại' })).toBeNull();
  });

  it('a chosen file goes to onFile; a refused one shows why', async () => {
    const onFile = vi.fn();
    const { rerender } = render(<UploadDialogView {...base({ onFile })} />);
    const file = new File(['x'], 'a.geojson');
    await userEvent.setup().upload(screen.getByLabelText('Chọn tệp'), file);
    expect(onFile).toHaveBeenCalledWith(file);
    rerender(<UploadDialogView {...base({ onFile, fileError: 'Tệp lớn hơn 200 MB.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Tệp lớn hơn 200 MB.');
  });

  it('shows Chưa chọn tệp. until a file is chosen, then its name', () => {
    const { rerender } = render(<UploadDialogView {...base()} />);
    expect(screen.getByText('Chưa chọn tệp.')).toBeInTheDocument();
    // The native input stays reachable by its label, but only the Vietnamese button and name are drawn.
    const input = screen.getByLabelText('Chọn tệp');
    expect(input).toHaveClass('visually-hidden');
    expect(input).toHaveAccessibleDescription(/Chưa chọn tệp\./);
    rerender(<UploadDialogView {...base({ fileName: 'Cống thoát nước.geojson' })} />);
    expect(screen.queryByText('Chưa chọn tệp.')).toBeNull();
    expect(screen.getByText('Cống thoát nước.geojson')).toBeInTheDocument();
    expect(screen.getByLabelText('Chọn tệp')).toHaveAccessibleDescription(/Cống thoát nước\.geojson/);
  });

  it('while uploading it shows the percentage', () => {
    render(<UploadDialogView {...base({ phase: 'uploading', progress: 42 })} />);
    expect(screen.getByText('Đang tải lên… 42%')).toBeInTheDocument();
    expect(screen.getByLabelText('Chọn tệp')).toBeDisabled();
  });

  it('shows the GeoJSON warning when told to', () => {
    const { rerender } = render(<UploadDialogView {...base()} />);
    expect(screen.queryByText(GEOJSON_WARNING)).toBeNull();
    rerender(<UploadDialogView {...base({ crsWarning: true })} />);
    expect(screen.getByText(GEOJSON_WARNING)).toBeInTheDocument();
  });

  it('a missing coordinate system drops Theo tệp, makes the CRS required and offers Nhập lại', async () => {
    const onRetry = vi.fn();
    render(<UploadDialogView {...base({
      phase: 'failed', crsRequired: true, canRetry: true, onRetry,
      error: 'Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn.', sourceCrs: 'vn2000-utm48',
    })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn.');
    const crs = screen.getByRole('combobox', { name: 'Hệ toạ độ nguồn' });
    expect(within(crs).queryByRole('option', { name: 'Theo tệp (tự nhận)' })).toBeNull();
    expect(crs).toBeRequired();
    expect(crs).toHaveValue('vn2000-utm48');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Nhập lại' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows the job steps while it runs and the success line at the end', () => {
    const job = {
      id: 'j1', kind: 'import' as const, status: 'succeeded' as const, mapId: 'm1', progress: 100,
      steps: [{ key: 'read', label: 'Đọc tệp', status: 'done' as const }],
      result: { layerIds: ['l1'], rows: 12 }, error: null, createdAt: '', finishedAt: '',
    };
    render(<UploadDialogView {...base({ phase: 'succeeded', job, successText: 'Đã nhập xong. 12 đối tượng.' })} />);
    expect(screen.getByText('Đọc tệp')).toBeInTheDocument();
    expect(screen.getByText('Đã nhập xong. 12 đối tượng.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tải lên và nhập' })).toBeNull();
  });
});
