import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResolvedRoi } from '@webatlas/shared';
import { ROI_TOOLS, toolAvailability, type Availability, type RoiTool } from '../../roi/model/toolAvailability';
import { AnalysisButtonsView } from './AnalysisButtons.view';

const availabilityFor = (roi: ResolvedRoi | null) =>
  Object.fromEntries(ROI_TOOLS.map((tool) => [tool, toolAvailability(tool, roi)])) as Record<RoiTool, Availability>;

const line: ResolvedRoi = {
  label: 'Sông Thu Bồn', kind: 'line', measure: { lengthKm: 212.4 },
  display: { type: 'LineString', coordinates: [[108, 15], [108.1, 15.1]] }, bbox: [108, 15, 108.1, 15.1], centroid: [108.05, 15.05],
};
const area: ResolvedRoi = { ...line, label: 'Tỉnh Đắk Lắk', kind: 'area', measure: { areaKm2: 896 } };

describe('AnalysisButtonsView', () => {
  it('labels the four tools with text, with no Vùng đệm', () => {
    render(<AnalysisButtonsView active={null} availability={availabilityFor(area)} hasRegion onOpen={vi.fn()} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Chọn trong vùng', 'Thống kê độ cao', 'Trắc diện độ cao', 'Gần nhất',
    ]);
  });

  it('with no region, every tool is disabled and one line says why', () => {
    render(<AnalysisButtonsView active={null} availability={availabilityFor(null)} hasRegion={false} onOpen={vi.fn()} />);
    expect(screen.getAllByText('Vẽ hoặc chọn một vùng trước.')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Chọn trong vùng' })).toHaveAccessibleDescription('Vẽ hoặc chọn một vùng trước.');
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription('Vẽ hoặc chọn một vùng trước.');
    }
    expect(screen.queryByText('Chưa có vùng phân tích')).toBeNull();
  });

  it('a tool the region does not suit says its own reason beside it', () => {
    render(<AnalysisButtonsView active={null} availability={availabilityFor(line)} hasRegion onOpen={vi.fn()} />);
    const zonal = screen.getByRole('button', { name: 'Thống kê độ cao' });
    expect(zonal).toHaveAttribute('aria-disabled', 'true');
    expect(zonal).toHaveAccessibleDescription('Cần một vùng — thêm bán kính');
    expect(screen.getByRole('button', { name: 'Chọn trong vùng' })).toHaveAccessibleDescription('Thêm bán kính để dùng cho đường này');
    expect(screen.queryByText('Vẽ hoặc chọn một vùng trước.')).toBeNull();
  });

  it('a tool that can run is not disabled and carries no reason', () => {
    render(<AnalysisButtonsView active={null} availability={availabilityFor(line)} hasRegion onOpen={vi.fn()} />);
    const profile = screen.getByRole('button', { name: 'Trắc diện độ cao' });
    expect(profile).not.toHaveAttribute('aria-disabled');
    expect(profile).not.toHaveAttribute('aria-describedby');
  });

  it('pressing a disabled tool does not open it', async () => {
    const onOpen = vi.fn();
    render(<AnalysisButtonsView active={null} availability={availabilityFor(line)} hasRegion onOpen={onOpen} />);
    const zonal = screen.getByRole('button', { name: 'Thống kê độ cao' });
    expect(zonal).not.toBeDisabled();
    await userEvent.click(zonal);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('pressing a tool that can run opens it, and the open one is pressed', async () => {
    const onOpen = vi.fn();
    render(<AnalysisButtonsView active="nearest" availability={availabilityFor(line)} hasRegion onOpen={onOpen} />);
    expect(screen.getByRole('button', { name: 'Gần nhất' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Trắc diện độ cao' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Trắc diện độ cao' }));
    expect(onOpen).toHaveBeenCalledWith('elevation_profile');
  });
});
