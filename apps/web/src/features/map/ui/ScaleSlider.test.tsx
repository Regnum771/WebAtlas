import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScaleSliderView } from './ScaleSlider';
import { ZOOM_STOPS, MIN_ZOOM, MAX_ZOOM } from '../model/zoomScale';

const base = {
  stopIndex: 5,
  zoom: ZOOM_STOPS[5],
  scaleText: '1:1.000.000',
  scaleName: null,
  onStopChange: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onReset: vi.fn(),
};

describe('ScaleSliderView', () => {
  it('draws one tick per stop and two heavier ones', () => {
    const { container } = render(<ScaleSliderView {...base} />);
    expect(container.querySelectorAll('.scale-tick')).toHaveLength(11);
    expect(container.querySelectorAll('.scale-tick.named')).toHaveLength(2);
  });

  it('puts the top tick on the most zoomed-in stop and hides the ticks from assistive technology', () => {
    const { container } = render(<ScaleSliderView {...base} />);
    const ticks = Array.from(container.querySelectorAll<HTMLElement>('.scale-tick'));
    expect(ticks.map((t) => t.style.top)).toEqual(
      Array.from({ length: 11 }, (_, i) => `${(10 - i) * 28}px`),
    );
    expect(ticks.every((t) => t.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(ticks.flatMap((t, i) => (t.classList.contains('named') ? [i] : []))).toEqual([7, 8]);
  });

  it('reads out the exact scale, and the name only when given one', () => {
    const { rerender } = render(<ScaleSliderView {...base} scaleText="1:250.000" scaleName="cấp vùng" />);
    expect(screen.getByRole('status')).toHaveTextContent('1:250.000');
    expect(screen.getByText('cấp vùng')).toBeInTheDocument();
    rerender(<ScaleSliderView {...base} scaleText="1:180.000" scaleName={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('1:180.000');
    expect(screen.queryByText(/cấp/)).toBeNull();
  });

  it('puts the handle on the stop it was given, over the eleven stops', () => {
    render(<ScaleSliderView {...base} stopIndex={3} />);
    const slider = screen.getByRole('slider', { name: 'Tỷ lệ bản đồ' });
    expect(slider).toHaveValue('3');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '10');
    expect(slider).toHaveAttribute('step', '1');
    expect(slider).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('reports the stop the handle was moved to', () => {
    const onStopChange = vi.fn();
    render(<ScaleSliderView {...base} onStopChange={onStopChange} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Tỷ lệ bản đồ' }), { target: { value: '3' } });
    expect(onStopChange).toHaveBeenCalledWith(3);
  });

  it('calls the zoom handlers from the + and − buttons', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    render(<ScaleSliderView {...base} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />);
    await userEvent.click(screen.getByRole('button', { name: 'Phóng to' }));
    await userEvent.click(screen.getByRole('button', { name: 'Thu nhỏ' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('disables + at the nearest scale and − at the farthest', () => {
    const { rerender } = render(<ScaleSliderView {...base} zoom={MAX_ZOOM} />);
    expect(screen.getByRole('button', { name: 'Phóng to' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Thu nhỏ' })).toBeEnabled();
    rerender(<ScaleSliderView {...base} zoom={MIN_ZOOM} />);
    expect(screen.getByRole('button', { name: 'Thu nhỏ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Phóng to' })).toBeEnabled();
  });

  it('Toàn vùng resets the view', async () => {
    const onReset = vi.fn();
    render(<ScaleSliderView {...base} onReset={onReset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Toàn vùng' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('tells assistive technology the scale, not the index', () => {
    render(<ScaleSliderView {...base} scaleText="1:1.247.000" />);
    expect(screen.getByRole('slider', { name: 'Tỷ lệ bản đồ' })).toHaveAttribute('aria-valuetext', '1:1.247.000');
  });
});
