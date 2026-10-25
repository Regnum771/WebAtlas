import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AnalysisResult } from '@webatlas/shared';
import { DICTIONARY, attributeOf } from '@webatlas/shared';
import { AnalysisResultCardView } from './AnalysisResultCard.view';

const DEM = attributeOf(DICTIONARY, 'dem', '1')!;

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
    render(<AnalysisResultCardView elevation={DEM} result={R} onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('Chọn trong vùng')).toBeInTheDocument();
    expect(screen.getByText('Tổng số')).toBeInTheDocument();
    expect(screen.getByText('Sông Hinh')).toBeInTheDocument();
    expect(screen.getByText('Chỉ hiển thị một phần kết quả trên bản đồ.')).toBeInTheDocument();
    expect(screen.getByText('FABDEM')).toBeInTheDocument();
  });

  it('wires row click, export and clear', () => {
    const onRow = vi.fn(); const onExport = vi.fn(); const onClear = vi.fn();
    render(<AnalysisResultCardView elevation={DEM} result={R} onRow={onRow} onExport={onExport} onClear={onClear} />);
    fireEvent.click(screen.getByText('Sông Hinh'));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xoá kết quả' }));
    expect(onRow).toHaveBeenCalledWith(R.rows![0]);
    expect(onExport).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
  });

  it('names the ROI the result was computed for (FR-10)', () => {
    render(<AnalysisResultCardView elevation={DEM} result={R} roiLabel="Sông Thu Bồn + 5 km" onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('Kết quả cho: Sông Thu Bồn + 5 km')).toBeInTheDocument();
  });

  it('says so in ink when nothing was found', () => {
    const { container } = render(
      <AnalysisResultCardView elevation={DEM} result={{ ...R, summary: { 'Tổng số': 0 }, rows: [] }} onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Không tìm thấy đối tượng nào trong vùng này.');
    expect(container.querySelector('.bad')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says nothing about missing rows when the tool returns none by design', () => {
    render(<AnalysisResultCardView elevation={DEM} result={{ ...R, op: 'zonal_elevation', rows: undefined }} onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.queryByText('Không tìm thấy đối tượng nào trong vùng này.')).toBeNull();
  });

  it('zonal elevation figures use the dem display unit', () => {
    const zonal: AnalysisResult = {
      op: 'zonal_elevation',
      summary: { 'Diện tích (km²)': 12, 'Thấp nhất (m)': 400, 'Cao nhất (m)': 520, 'Trung bình (m)': 1234.5, 'Số điểm ảnh': 9 },
      geometries: [],
    };
    render(<AnalysisResultCardView elevation={{ ...DEM, displayUnit: 'cm' }} result={zonal} onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('Cao nhất').nextSibling).toHaveTextContent('52.000 cm');
    expect(screen.getByText('Thấp nhất').nextSibling).toHaveTextContent('40.000 cm');
    expect(screen.getByText('Trung bình').nextSibling).toHaveTextContent('123.450 cm');
    expect(screen.getByText('Diện tích (km²)').nextSibling).toHaveTextContent('12');
  });

  it('sits in the tool menu as a plain block, not a glass card', () => {
    const { container } = render(<AnalysisResultCardView elevation={DEM} result={R} onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(container.querySelector('.glass-panel')).toBeNull();
  });

  it('renders a row action beside each row that has one', () => {
    render(<AnalysisResultCardView elevation={DEM} result={R} onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()}
      renderRowAction={(row) => <button type="button">Dùng {row.name}</button>} />);
    expect(screen.getByRole('button', { name: 'Dùng Sông Hinh' })).toBeInTheDocument();
  });
});
