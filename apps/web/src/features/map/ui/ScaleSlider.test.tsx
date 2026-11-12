import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScaleSliderView, ZoomControlsView, stopPosition } from './ScaleSlider';
import { ZOOM_STOPS, MIN_ZOOM, MAX_ZOOM } from '../model/zoomScale';

// Radix measures the thumb; jsdom has no ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

const base = {
  stopIndex: 5,
  scaleText: '1:1.000.000',
  scaleName: null,
  onStopChange: vi.fn(),
};

describe('ScaleSliderView', () => {
  it('draws one tick per stop, the two named ones heavier, hidden from assistive technology', () => {
    const { container } = render(<ScaleSliderView {...base} />);
    const ticks = Array.from(container.querySelectorAll<HTMLElement>('[data-tick]'));
    expect(ticks).toHaveLength(11);
    expect(ticks.flatMap((t, i) => (t.dataset.tick === 'named' ? [i] : []))).toEqual([7, 8]);
    expect(ticks.every((t) => t.closest('[aria-hidden="true"]'))).toBe(true);
  });

  it('puts the ticks where Radix centres the thumb: inset by half a thumb at the ends', () => {
    expect(stopPosition(0)).toBe('calc(0% + 6px)');
    expect(stopPosition(5)).toBe('calc(50% + 0px)');
    expect(stopPosition(7)).toBe('calc(70% - 2.4px)');
    expect(stopPosition(10)).toBe('calc(100% - 6px)');
    const { container } = render(<ScaleSliderView {...base} />);
    const ticks = Array.from(container.querySelectorAll<HTMLElement>('[data-tick]'));
    expect(ticks.map((t) => t.style.left)).toEqual(Array.from({ length: 11 }, (_, i) => stopPosition(i)));
  });

  it('labels the two named stops', () => {
    render(<ScaleSliderView {...base} />);
    expect(screen.getByText('cấp vùng')).toBeInTheDocument();
    expect(screen.getByText('cấp tỉnh')).toBeInTheDocument();
  });

  it('reads out the exact scale, and the name only while the view rests on a named stop', () => {
    const { container, rerender } = render(<ScaleSliderView {...base} scaleText="1:250.000" scaleName="cấp vùng" />);
    const readout = container.querySelector('output') as HTMLElement;
    expect(readout).toHaveTextContent('1:250.000cấp vùng');
    rerender(<ScaleSliderView {...base} scaleText="1:180.000" scaleName={null} />);
    expect(readout).toHaveTextContent(/^1:180\.000$/);
  });

  it('puts the thumb on the stop it was given, over the eleven stops', () => {
    render(<ScaleSliderView {...base} stopIndex={3} />);
    const slider = screen.getByRole('slider', { name: 'Tỷ lệ bản đồ' });
    expect(slider).toHaveAttribute('aria-valuenow', '3');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '10');
    expect(slider).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('moves one stop per arrow key and reports it', () => {
    const onStopChange = vi.fn();
    render(<ScaleSliderView {...base} onStopChange={onStopChange} />);
    const slider = screen.getByRole('slider', { name: 'Tỷ lệ bản đồ' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onStopChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onStopChange).toHaveBeenLastCalledWith(4);
  });

  it('tells assistive technology the scale, and its name on a named stop, not the index', () => {
    const { rerender } = render(<ScaleSliderView {...base} scaleText="1:1.247.000" />);
    expect(screen.getByRole('slider', { name: 'Tỷ lệ bản đồ' })).toHaveAttribute('aria-valuetext', '1:1.247.000');
    rerender(<ScaleSliderView {...base} stopIndex={8} scaleText="1:100.000" scaleName="cấp tỉnh" />);
    expect(screen.getByRole('slider', { name: 'Tỷ lệ bản đồ' })).toHaveAttribute('aria-valuetext', '1:100.000, cấp tỉnh');
  });
});

describe('ZoomControlsView', () => {
  const zoomBase = { zoom: ZOOM_STOPS[5], onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() };

  it('stacks zoom in, zoom out and the whole work area, in that order', () => {
    render(<ZoomControlsView {...zoomBase} />);
    const group = screen.getByRole('group', { name: 'Phóng to, thu nhỏ' });
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Phóng to', 'Thu nhỏ', 'Toàn vùng']);
  });

  it('calls the zoom handlers and the reset', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();
    render(<ZoomControlsView {...zoomBase} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={onReset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Phóng to' }));
    await userEvent.click(screen.getByRole('button', { name: 'Thu nhỏ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Toàn vùng' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('disables + at the nearest scale and − at the farthest', () => {
    const { rerender } = render(<ZoomControlsView {...zoomBase} zoom={MAX_ZOOM} />);
    expect(screen.getByRole('button', { name: 'Phóng to' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Thu nhỏ' })).toBeEnabled();
    rerender(<ZoomControlsView {...zoomBase} zoom={MIN_ZOOM} />);
    expect(screen.getByRole('button', { name: 'Thu nhỏ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Phóng to' })).toBeEnabled();
  });

  it('names each button in a tooltip on hover', async () => {
    const user = userEvent.setup();
    render(<ZoomControlsView {...zoomBase} />);
    await user.hover(screen.getByRole('button', { name: 'Toàn vùng' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Toàn vùng');
  });
});
