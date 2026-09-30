import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  stops: [] as ReturnType<typeof vi.fn>[],
  onDones: [] as ((g: unknown) => void)[],
  kinds: [] as string[],
  ctx: { map: {} },
}));
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => h.ctx }));
vi.mock('../../map/model/roiDraw', () => ({
  startRoiDraw: (_map: unknown, kind: string, onDone: (g: unknown) => void) => {
    const stop = vi.fn();
    h.stops.push(stop); h.onDones.push(onDone); h.kinds.push(kind);
    return stop;
  },
}));

import RoiDrawButtons, { RoiDrawButtonsView } from './RoiDrawButtons';
import { getRoiState, resetRoiStore, setRoiResolver } from '../model/roi.store';
import { claimDrawing, getDrawFeedback, resetDrawing } from '../../map/model/drawingState';

describe('RoiDrawButtonsView', () => {
  it('offers the four draw tools in the Vẽ group (D5)', () => {
    render(<RoiDrawButtonsView active={null} onDraw={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Vẽ' });
    for (const name of ['Vẽ đa giác', 'Vẽ hình chữ nhật', 'Vẽ đường', 'Chọn một điểm']) {
      expect(within(group).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks the active one and reports presses', async () => {
    const onDraw = vi.fn();
    render(<RoiDrawButtonsView active="Box" onDraw={onDraw} />);
    expect(screen.getByRole('button', { name: 'Vẽ hình chữ nhật' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Vẽ đường' }));
    expect(onDraw).toHaveBeenCalledWith('LineString');
  });
});

describe('RoiDrawButtons container', () => {
  beforeEach(() => {
    h.stops.length = 0; h.onDones.length = 0; h.kinds.length = 0;
    resetRoiStore(); resetDrawing();
  });

  it('a tool press claims drawing for the ROI and starts drawing', async () => {
    render(<RoiDrawButtons />);
    await userEvent.click(screen.getByRole('button', { name: 'Vẽ đa giác' }));
    expect(getRoiState()).toMatchObject({ status: 'drawing', drawKind: 'Polygon' });
    expect(getDrawFeedback().owner).toBe('roi');
    expect(h.kinds).toEqual(['Polygon']);
  });

  it('pressing the same tool again stops the draw and releases ownership', async () => {
    render(<RoiDrawButtons />);
    const btn = screen.getByRole('button', { name: 'Vẽ đa giác' });
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(h.stops[0]).toHaveBeenCalled();
    expect(getDrawFeedback().owner).toBeNull();
    expect(getRoiState().status).not.toBe('drawing');
  });

  it('switching tools stops the first draw and starts the second', async () => {
    render(<RoiDrawButtons />);
    await userEvent.click(screen.getByRole('button', { name: 'Vẽ đa giác' }));
    await userEvent.click(screen.getByRole('button', { name: 'Vẽ đường' }));
    expect(h.stops[0]).toHaveBeenCalled();
    expect(h.kinds).toEqual(['Polygon', 'LineString']);
    expect(getDrawFeedback().owner).toBe('roi');
  });

  it('Esc cancels the drawing', async () => {
    render(<RoiDrawButtons />);
    await userEvent.click(screen.getByRole('button', { name: 'Vẽ đa giác' }));
    await userEvent.keyboard('{Escape}');
    expect(h.stops[0]).toHaveBeenCalled();
    expect(getRoiState().status).not.toBe('drawing');
    expect(getDrawFeedback().owner).toBeNull();
  });

  it('stops when the ruler takes the map', async () => {
    render(<RoiDrawButtons />);
    await userEvent.click(screen.getByRole('button', { name: 'Vẽ đa giác' }));
    act(() => claimDrawing('ruler'));
    expect(h.stops[0]).toHaveBeenCalled();
    expect(getRoiState().status).not.toBe('drawing');
    expect(getDrawFeedback().owner).toBe('ruler');
  });

  it('a finished shape becomes the drawn ROI', async () => {
    const resolver = vi.fn(async () => ({ display: { type: 'Point', coordinates: [108, 13] }, label: 'Điểm', analysis: { type: 'Point', coordinates: [108, 13] } }) as never);
    setRoiResolver(resolver);
    render(<RoiDrawButtons />);
    await userEvent.click(screen.getByRole('button', { name: 'Chọn một điểm' }));
    const geometry = { type: 'Point', coordinates: [108, 13] };
    await act(async () => { h.onDones[0](geometry); });
    expect(resolver).toHaveBeenCalledWith({ source: 'drawn', geometry });
    expect(getRoiState().status).not.toBe('drawing');
  });
});
