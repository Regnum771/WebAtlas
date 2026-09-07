import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapToolbarView } from './MapToolbar';

const base = {
  zoom: 9,
  scaleText: '1:200.000',
  measureMode: 'none' as const,
  measureValue: null,
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onReset: vi.fn(),
  onMeasure: vi.fn(),
  onBasemap: vi.fn(),
};

describe('MapToolbarView', () => {
  it('renders the current scale', () => {
    render(<MapToolbarView {...base} />);
    expect(screen.getByText('1:200.000')).toBeInTheDocument();
  });

  it('calls onReset when the home button is pressed', async () => {
    const onReset = vi.fn();
    render(<MapToolbarView {...base} onReset={onReset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Về vùng công tác' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('shows the measurement readout when there is a value', () => {
    render(<MapToolbarView {...base} measureMode="length" measureValue="42,3 km" />);
    expect(screen.getByText('42,3 km')).toBeInTheDocument();
  });

  it('marks the active measure tool as pressed', () => {
    render(<MapToolbarView {...base} measureMode="area" />);
    expect(screen.getByRole('button', { name: /Đo diện tích/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
