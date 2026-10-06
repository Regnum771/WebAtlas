import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  measure: { mode: 'none' as 'none' | 'length' | 'area', value: null as string | null, start: vi.fn(), clear: vi.fn() },
}));
vi.mock('../model/useMeasure', () => ({ useMeasure: () => h.measure }));

import MeasureTool, { MeasureToolView } from './MeasureTool';

describe('MeasureToolView', () => {
  it('offers length and area, and marks the active one as pressed', () => {
    render(<MeasureToolView mode="area" value={null} onMeasure={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Diện tích' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Chiều dài' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the value in an output', () => {
    render(<MeasureToolView mode="length" value="Chiều dài: 42.3 km" onMeasure={vi.fn()} />);
    const output = screen.getByRole('status');
    expect(output.tagName).toBe('OUTPUT');
    expect(output).toHaveTextContent('Chiều dài: 42.3 km');
  });

  it('reports the pressed button', async () => {
    const onMeasure = vi.fn();
    render(<MeasureToolView mode="none" value={null} onMeasure={onMeasure} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chiều dài' }));
    expect(onMeasure).toHaveBeenCalledWith('length');
  });
});

describe('MeasureTool', () => {
  beforeEach(() => {
    h.measure = { mode: 'none', value: null, start: vi.fn(), clear: vi.fn() };
  });

  it('starts the measurement that was pressed', async () => {
    render(<MeasureTool active />);
    await userEvent.click(screen.getByRole('button', { name: 'Diện tích' }));
    expect(h.measure.start).toHaveBeenCalledWith('area');
    expect(h.measure.clear).not.toHaveBeenCalled();
  });

  it('pressing the active measurement stops it', async () => {
    h.measure.mode = 'length';
    render(<MeasureTool active />);
    await userEvent.click(screen.getByRole('button', { name: 'Chiều dài' }));
    expect(h.measure.clear).toHaveBeenCalledTimes(1);
    expect(h.measure.start).not.toHaveBeenCalled();
  });

  it('stops measuring when its menu closes', () => {
    h.measure.mode = 'length';
    const { rerender } = render(<MeasureTool active />);
    expect(h.measure.clear).not.toHaveBeenCalled();
    rerender(<MeasureTool active={false} />);
    expect(h.measure.clear).toHaveBeenCalledTimes(1);
  });

  it('leaves the ruler alone while its menu stays closed', () => {
    const { rerender } = render(<MeasureTool active={false} />);
    rerender(<MeasureTool active={false} />);
    expect(h.measure.clear).not.toHaveBeenCalled();
  });
});
