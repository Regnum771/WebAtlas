import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrintPageView, type PrintPageViewProps } from './PrintPage.view';

function props(over: Partial<PrintPageViewProps> = {}): PrintPageViewProps {
  return {
    title: 'Bản đồ', onTitle: vi.fn(), paper: 'A4-landscape', onPaper: vi.fn(),
    toggles: { legend: true, scale: true, north: true, date: true, crs: true }, onToggle: vi.fn(),
    imageUrl: 'blob:map', capturing: false, exportError: null,
    attributions: ['Nền bản đồ: © OpenStreetMap contributors (ODbL)'],
    scaleText: '1:250.000', crsLabel: 'WGS 84', date: '17/9/2026',
    legend: <div>LEGEND</div>, analysis: null,
    onDownload: vi.fn(), onPrint: vi.fn(), onClose: vi.fn(),
    ...over,
  };
}

describe('PrintPageView', () => {
  it('renders the sheet with title, map image, scale, CRS, date, legend and attributions', () => {
    render(<PrintPageView {...props()} />);
    expect(screen.getByRole('heading', { name: 'Bản đồ' })).toBeInTheDocument();
    expect(screen.getByAltText('Bản đồ in')).toHaveAttribute('src', 'blob:map');
    expect(screen.getByText('Tỷ lệ (theo màn hình): 1:250.000')).toBeInTheDocument();
    expect(screen.getByText('Hệ quy chiếu: WGS 84')).toBeInTheDocument();
    expect(screen.getByText('LEGEND')).toBeInTheDocument();
    expect(screen.getByText('Nền bản đồ: © OpenStreetMap contributors (ODbL)')).toBeInTheDocument();
  });

  it('hides optional elements when toggled off, but never the attributions', () => {
    render(<PrintPageView {...props({ toggles: { legend: false, scale: false, north: false, date: false, crs: false } })} />);
    expect(screen.queryByText('LEGEND')).toBeNull();
    expect(screen.queryByText(/Tỷ lệ/)).toBeNull();
    expect(screen.getByText('Nền bản đồ: © OpenStreetMap contributors (ODbL)')).toBeInTheDocument();
  });

  it('shows the export error and disables PNG download without an image', () => {
    render(<PrintPageView {...props({ imageUrl: null, exportError: 'Không xuất được ảnh' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Không xuất được ảnh');
    expect(screen.getByRole('button', { name: 'Tải PNG' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  });
});
