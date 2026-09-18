import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapToolbarView } from './MapToolbar';
import { ZOOM_STOPS } from '../model/zoomScale';

const baseProps = {
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
  stopIndex: 0,
  onStopChange: vi.fn(),
};

describe('MapToolbarView', () => {
  it('renders the current scale', () => {
    render(<MapToolbarView {...baseProps} />);
    expect(screen.getByText('1:200.000')).toBeInTheDocument();
  });

  it('calls onReset when the home button is pressed', async () => {
    const onReset = vi.fn();
    render(<MapToolbarView {...baseProps} onReset={onReset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Về vùng công tác' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('shows the measurement readout when there is a value', () => {
    render(<MapToolbarView {...baseProps} measureMode="length" measureValue="42,3 km" />);
    expect(screen.getByText('42,3 km')).toBeInTheDocument();
  });

  it('marks the active measure tool as pressed', () => {
    render(<MapToolbarView {...baseProps} measureMode="area" />);
    expect(screen.getByRole('button', { name: /Đo diện tích/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lays out as a bottom pill that clears the flyout when one is open', () => {
    const { container, rerender } = render(<MapToolbarView {...baseProps} flyoutOpen={false} />);
    const bar = container.querySelector('.map-toolbar');
    expect(bar).not.toBeNull();
    expect(bar).not.toHaveClass('flyout-open');

    rerender(<MapToolbarView {...baseProps} flyoutOpen />);
    expect(container.querySelector('.map-toolbar')).toHaveClass('flyout-open');
  });

  it('still reports every existing action after the layout change', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onMeasure = vi.fn();
    const onBasemap = vi.fn();
    render(
      <MapToolbarView
        {...baseProps}
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

  it('puts the handle on the stop it was given', () => {
    render(<MapToolbarView {...baseProps} stopIndex={3} />);
    expect(screen.getByRole('slider', { name: 'Mức thu phóng' })).toHaveValue('3');
  });

  it('reports the stop it was moved to', () => {
    const onStopChange = vi.fn();
    render(<MapToolbarView {...baseProps} stopIndex={3} onStopChange={onStopChange} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Mức thu phóng' }), { target: { value: '6' } });
    expect(onStopChange).toHaveBeenCalledWith(6);
  });

  it('spans exactly the eight scale stops', () => {
    render(<MapToolbarView {...baseProps} stopIndex={0} />);
    const slider = screen.getByRole('slider', { name: 'Mức thu phóng' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', String(ZOOM_STOPS.length - 1));
    expect(slider).toHaveAttribute('step', '1');
  });

  it('shows the true scale, not the stop the handle sits on', () => {
    // The handle is an approximate position indicator; the number is the truth.
    render(<MapToolbarView {...baseProps} stopIndex={4} scaleText="1:1.247.000" />);
    expect(screen.getByText('1:1.247.000')).toBeInTheDocument();
  });

  it('renders the analysis slots when provided', () => {
    render(<MapToolbarView {...baseProps} analysisButtons={<button>Vùng đệm</button>} analysisPanel={<p>panel</p>} />);
    expect(screen.getByRole('button', { name: 'Vùng đệm' })).toBeInTheDocument();
    expect(screen.getByText('panel')).toBeInTheDocument();
  });
});
