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
  flyoutOpen: false,
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

  it('lays out as a bottom pill that clears the flyout when one is open', () => {
    const { container, rerender } = render(<MapToolbarView {...base} flyoutOpen={false} />);
    const bar = container.querySelector('.map-toolbar');
    expect(bar).not.toBeNull();
    expect(bar).not.toHaveClass('flyout-open');

    rerender(<MapToolbarView {...base} flyoutOpen />);
    expect(container.querySelector('.map-toolbar')).toHaveClass('flyout-open');
  });

  it('still reports every existing action after the layout change', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onMeasure = vi.fn();
    const onBasemap = vi.fn();
    render(
      <MapToolbarView
        {...base}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onMeasure={onMeasure}
        onBasemap={onBasemap}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Phóng to' }));
    await userEvent.click(screen.getByRole('button', { name: 'Thu nhỏ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Đo chiều dài (sông)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Vệ tinh' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onMeasure).toHaveBeenCalledWith('length');
    expect(onBasemap).toHaveBeenCalledWith('satellite');
  });
});
