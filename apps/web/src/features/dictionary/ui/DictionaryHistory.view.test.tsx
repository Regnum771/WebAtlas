import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DictionaryHistoryView, type HistoryRowView } from './DictionaryHistory.view';

const base: HistoryRowView = { id: 1, who: 'Lan', when: '25/10/2026 10:00', field: 'Nhãn', change: 'A → B', reason: 'sửa' };

describe('DictionaryHistoryView', () => {
  it('history shows reasons in Vietnamese', () => {
    render(<DictionaryHistoryView loading={false} rows={[
      base,
      { ...base, id: 2, reason: 'khôi phục' },
      { ...base, id: 3, who: 'Hệ thống', reason: 'đồng bộ hoàn nguyên' },
      { ...base, id: 4, who: 'Hệ thống', reason: 'đồng bộ ngừng dùng' },
    ]} />);
    for (const r of ['sửa', 'khôi phục', 'đồng bộ hoàn nguyên', 'đồng bộ ngừng dùng']) {
      expect(screen.getByText(r)).toBeInTheDocument();
    }
    expect(screen.getAllByText('A → B')).toHaveLength(4);
  });

  it('says so when nothing was changed', () => {
    render(<DictionaryHistoryView loading={false} rows={[]} />);
    expect(screen.getByText('Chưa có thay đổi nào.')).toBeInTheDocument();
  });
});
