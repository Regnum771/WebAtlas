import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsageTableView } from './UsageTable.view';

const row = (over: Record<string, unknown> = {}) => ({
  userId: 'u1', email: 'a@b.test', maps: 2, layers: 3, features: 40, bytes: 0,
  usageBytes: 12_897_484, quotaBytes: 1073741824, overQuota: false, ...over,
});
const base = {
  rows: [row()], loading: false, error: null, editingId: null, draft: '1', saving: false, saveError: null, canSave: true,
  onStartEdit: vi.fn(), onDraft: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(),
};

describe('UsageTableView', () => {
  it('shows the columns and formatted sizes', () => {
    render(<UsageTableView {...base} />);
    for (const h of ['Người dùng', 'Bản đồ', 'Lớp', 'Đối tượng', 'Đã dùng', 'Hạn mức']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText('a@b.test')).toBeInTheDocument();
    expect(screen.getByText('12,3 MB')).toBeInTheDocument();
    expect(screen.getByText('1 GB')).toBeInTheDocument();
    expect(screen.queryByText('Vượt hạn mức')).toBeNull();
  });

  it('marks a row over its quota', () => {
    render(<UsageTableView {...base} rows={[row({ overQuota: true })]} />);
    expect(screen.getByText('Vượt hạn mức')).toBeInTheDocument();
  });

  it('opens the editor with Sửa and offers Lưu and Huỷ', async () => {
    const onStartEdit = vi.fn(); const onSave = vi.fn(); const onCancel = vi.fn();
    const { rerender } = render(<UsageTableView {...base} onStartEdit={onStartEdit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    expect(onStartEdit).toHaveBeenCalledWith('u1');
    rerender(<UsageTableView {...base} editingId="u1" onSave={onSave} onCancel={onCancel} />);
    const cell = screen.getByRole('spinbutton', { name: 'Hạn mức (GB)' });
    expect(cell).toHaveValue(1);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onSave).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(within(screen.getByRole('table')).queryByRole('button', { name: 'Sửa' })).toBeNull();
  });

  it('shows the save error as it comes', () => {
    render(<UsageTableView {...base} editingId="u1" saveError="Từ chối" />);
    expect(screen.getByText('Từ chối')).toBeInTheDocument();
  });
});
