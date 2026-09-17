import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AnalysisResult } from '@webatlas/shared';
import { AnalysisResultCardView } from './AnalysisResultCard.view';

const R: AnalysisResult = {
  op: 'select_within',
  summary: { 'Tổng số': 30, 'đập & hồ chứa': 30 },
  rows: [{ layerKey: 'dams', featureId: 'f1', name: 'Sông Hinh', lon: 108.99, lat: 12.93 }],
  geometries: [],
  truncated: true,
  attribution: 'FABDEM',
};

describe('AnalysisResultCardView', () => {
  it('shows title, summary, rows, truncation note and attribution', () => {
    render(<AnalysisResultCardView result={R} onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('Chọn trong vùng')).toBeInTheDocument();
    expect(screen.getByText('Tổng số')).toBeInTheDocument();
    expect(screen.getByText('Sông Hinh')).toBeInTheDocument();
    expect(screen.getByText('Chỉ hiển thị một phần kết quả trên bản đồ.')).toBeInTheDocument();
    expect(screen.getByText('FABDEM')).toBeInTheDocument();
  });

  it('wires row click, export and clear', () => {
    const onRow = vi.fn(); const onExport = vi.fn(); const onClear = vi.fn();
    render(<AnalysisResultCardView result={R} onRow={onRow} onExport={onExport} onClear={onClear} />);
    fireEvent.click(screen.getByText('Sông Hinh'));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xoá kết quả' }));
    expect(onRow).toHaveBeenCalledWith(R.rows![0]);
    expect(onExport).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
  });
});
