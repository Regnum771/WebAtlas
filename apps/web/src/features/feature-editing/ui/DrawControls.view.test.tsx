import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DrawControlsView } from './DrawControls.view';

describe('DrawControlsView', () => {
  it.each([
    ['Point', 'điểm'],
    ['MultiLineString', 'đường'],
    ['MultiPolygon', 'vùng'],
  ])('names a %s as "%s" in the idle hint', (geomType, word) => {
    render(<DrawControlsView geomType={geomType} mode="idle" onStartDraw={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(`Bấm Vẽ rồi đặt ${word} lên bản đồ.`)).toBeInTheDocument();
  });

  it('falls back to the raw value for a geometry type it has no word for', () => {
    render(<DrawControlsView geomType="Polygon" mode="idle" onStartDraw={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Bấm Vẽ rồi đặt Polygon lên bản đồ.')).toBeInTheDocument();
  });

  it('starts drawing from Vẽ', async () => {
    const onStartDraw = vi.fn();
    render(<DrawControlsView geomType="Point" mode="idle" onStartDraw={onStartDraw} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Vẽ' }));
    expect(onStartDraw).toHaveBeenCalled();
  });

  it('while drawing says Đang vẽ, shows the hint and offers Huỷ', async () => {
    const onCancel = vi.fn();
    render(<DrawControlsView geomType="MultiPolygon" mode="drawing" onStartDraw={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: 'Đang vẽ' })).toBeDisabled();
    expect(screen.getByText('Vẽ vùng lên bản đồ để tiếp tục.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
