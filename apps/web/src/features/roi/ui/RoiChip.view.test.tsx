import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResolvedRoi } from '@webatlas/shared';
import type { RoiState } from '../model/roi.store';
import { RoiChipView } from './RoiChip.view';

const line: ResolvedRoi = {
  label: 'Sông Thu Bồn', kind: 'line', measure: { lengthKm: 212.4 },
  display: { type: 'LineString', coordinates: [[108, 15], [108.1, 15.1]] }, bbox: [108, 15, 108.1, 15.1], centroid: [108.05, 15.05],
};
const base: RoiState = { roi: null, resolved: null, status: 'empty', error: null, hint: null, drawKind: null, fit: false };
const ready: RoiState = {
  ...base, status: 'ready', resolved: line,
  roi: { source: 'feature', layerKey: 'rivers', featureId: 'r1', whole: true },
};
const handlers = () => ({ onRadius: vi.fn(), onClear: vi.fn(), onDismiss: vi.fn() });

describe('RoiChipView — the five states (U-3)', () => {
  it('empty: says how to set one', () => {
    render(<RoiChipView state={base} {...handlers()} />);
    expect(screen.getByText(/Chưa có vùng phân tích/)).toBeInTheDocument();
  });

  it('drawing: shows the hint for the kind, and a live measure when given', () => {
    render(<RoiChipView state={{ ...base, status: 'drawing', drawKind: 'Polygon' }} liveMeasure="3,2 km²" {...handlers()} />);
    expect(screen.getByText(/nhấp đúp hoặc Enter để kết thúc/)).toBeInTheDocument();
    expect(screen.getByText('3,2 km²')).toBeInTheDocument();
  });

  it('resolving: says so', () => {
    render(<RoiChipView state={{ ...base, status: 'resolving' }} {...handlers()} />);
    expect(screen.getByText('Đang xác định vùng…')).toBeInTheDocument();
  });

  it('ready: label, kind, measure, radius and clear', async () => {
    const h = handlers();
    render(<RoiChipView state={ready} {...h} />);
    expect(screen.getByText('Sông Thu Bồn')).toBeInTheDocument();
    expect(screen.getByText('· đường · 212 km')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ vùng phân tích' }));
    expect(h.onClear).toHaveBeenCalled();
  });

  it('error: keeps the ROI and shows the reason, dismissible', async () => {
    const h = handlers();
    render(<RoiChipView state={{ ...ready, error: 'Vùng phân tích quá lớn' }} {...h} />);
    expect(screen.getByText('Sông Thu Bồn')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Vùng phân tích quá lớn');
    await userEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(h.onDismiss).toHaveBeenCalled();
  });
});

describe('RoiChipView — the radius editor (U-4)', () => {
  it('offers a radius only for a line or point, or to change an existing one', () => {
    const { rerender } = render(<RoiChipView state={ready} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Bán kính' })).toBeInTheDocument();
    const area = { ...line, kind: 'area' as const, measure: { areaKm2: 18086 } };
    rerender(<RoiChipView state={{ ...ready, resolved: area, roi: { source: 'admin', level: 'province', code: '66' } }} {...handlers()} />);
    expect(screen.queryByRole('button', { name: 'Bán kính' })).toBeNull();
    rerender(<RoiChipView state={{ ...ready, resolved: area, roi: { source: 'feature', layerKey: 'rivers', featureId: 'r1', radiusKm: 5 } }} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Bán kính: 5 km' })).toBeInTheDocument();
  });

  it('applies a preset, a typed value with Enter, and cancels with Esc', async () => {
    const h = handlers();
    render(<RoiChipView state={ready} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bán kính' }));
    await userEvent.click(screen.getByRole('button', { name: '2 km' }));
    expect(h.onRadius).toHaveBeenLastCalledWith(2);

    await userEvent.click(screen.getByRole('button', { name: 'Bán kính' }));
    const input = screen.getByRole('spinbutton', { name: 'Bán kính (km)' });
    await userEvent.clear(input);
    await userEvent.type(input, '7.5{Enter}');
    expect(h.onRadius).toHaveBeenLastCalledWith(7.5);

    await userEvent.click(screen.getByRole('button', { name: 'Bán kính' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('refuses a radius outside (0, 100]', async () => {
    const h = handlers();
    render(<RoiChipView state={ready} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bán kính' }));
    const input = screen.getByRole('spinbutton', { name: 'Bán kính (km)' });
    await userEvent.clear(input);
    await userEvent.type(input, '150{Enter}');
    expect(h.onRadius).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Áp dụng bán kính' })).toBeDisabled();
  });

  it('removes an existing radius', async () => {
    const h = handlers();
    const area = { ...line, kind: 'area' as const, measure: { areaKm2: 896 } };
    render(<RoiChipView state={{ ...ready, resolved: area, roi: { source: 'feature', layerKey: 'rivers', featureId: 'r1', radiusKm: 5 } }} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bán kính: 5 km' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ bán kính' }));
    expect(h.onRadius).toHaveBeenLastCalledWith(null);
  });
});
