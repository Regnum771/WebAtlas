import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportsListView } from './ExportsList.view';
import type { Job } from '../api/workspace.api';

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1', kind: 'export', status: 'succeeded', mapId: 'm1', progress: 100, steps: [], result: null, error: null,
  createdAt: '2026-10-23T00:00:00Z', finishedAt: '2026-10-23T12:00:00Z', ...over,
});
const base = { error: null, downloadingId: null, deletingId: null, onDownload: vi.fn(), onDelete: vi.fn() };

describe('ExportsListView', () => {
  it('says so when there are no files', () => {
    render(<ExportsListView {...base} jobs={[]} />);
    expect(screen.getByRole('heading', { name: 'Tệp đã xuất' })).toBeInTheDocument();
    expect(screen.getByText('Chưa có tệp nào.')).toBeInTheDocument();
  });

  it('a row reads the export time and an expiry seven days after it finished', () => {
    render(<ExportsListView {...base} jobs={[job()]} />);
    const expires = new Date(Date.parse('2026-10-23T12:00:00Z') + 7 * 86_400_000).toLocaleDateString('vi-VN');
    expect(screen.getByText(new RegExp(`^Xuất lúc .+ · hết hạn ${expires}$`))).toBeInTheDocument();
  });

  it('Tải and Xoá act on their row', async () => {
    const onDownload = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<ExportsListView {...base} onDownload={onDownload} onDelete={onDelete} jobs={[job({ id: 'a' }), job({ id: 'b' })]} />);
    const rows = screen.getAllByRole('listitem');
    await user.click(within(rows[1]).getByRole('button', { name: 'Tải' }));
    await user.click(within(rows[0]).getByRole('button', { name: 'Xoá' }));
    expect(onDownload).toHaveBeenCalledWith('b');
    expect(onDelete).toHaveBeenCalledWith('a');
  });

  it('a failed row shows the job error and cannot be downloaded', () => {
    render(<ExportsListView {...base} jobs={[job({ status: 'failed', error: 'Không ghi được tệp.' })]} />);
    expect(screen.getByText('Không ghi được tệp.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tải' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xoá' })).toBeInTheDocument();
  });

  it('shows a refused action\'s message', () => {
    render(<ExportsListView {...base} error="Công việc đang chạy, chưa xoá được." jobs={[job({ status: 'running', finishedAt: null })]} />);
    expect(screen.getByText('Công việc đang chạy, chưa xoá được.')).toBeInTheDocument();
  });
});
