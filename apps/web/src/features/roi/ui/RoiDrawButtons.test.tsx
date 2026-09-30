import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoiDrawButtonsView } from './RoiDrawButtons';

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
