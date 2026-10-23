import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Job } from '../api/workspace.api';
import { JobProgressView } from './JobProgress.view';

const JOB: Job = {
  id: 'j1', kind: 'import', status: 'running', mapId: 'm1', progress: 40,
  steps: [
    { key: 'read', label: 'Đọc tệp', status: 'done' },
    { key: 'transform', label: 'Chuyển hệ toạ độ', status: 'running', message: 'Bỏ qua 2 dòng không có hình.' },
    { key: 'write', label: 'Ghi vào bản đồ', status: 'pending' },
  ],
  result: null, error: null, createdAt: '2026-10-23T00:00:00Z', finishedAt: null,
};

describe('JobProgressView', () => {
  it("shows each step's label, state word and message", () => {
    render(<JobProgressView job={JOB} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('Đọc tệp')).toBeInTheDocument();
    expect(within(items[0]).getByText('Xong')).toBeInTheDocument();
    expect(within(items[1]).getByText('Chuyển hệ toạ độ')).toBeInTheDocument();
    expect(within(items[1]).getByText('Đang chạy')).toBeInTheDocument();
    expect(within(items[1]).getByText('Bỏ qua 2 dòng không có hình.')).toBeInTheDocument();
    expect(within(items[2]).getByText('Ghi vào bản đồ')).toBeInTheDocument();
    expect(within(items[2]).getByText('Chờ')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '40');
  });

  it('a failed step says Lỗi', () => {
    render(<JobProgressView job={{ ...JOB, status: 'failed', steps: [{ key: 'read', label: 'Đọc tệp', status: 'failed' }] }} />);
    expect(screen.getByText('Lỗi')).toBeInTheDocument();
  });
});
