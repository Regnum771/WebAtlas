import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimeSliderView } from './TimeSlider.view';

const steps = ['2025-10-26T00:00:00Z', '2025-10-26T01:00:00Z', '2025-10-26T02:00:00Z'];
const props = () => ({
  steps, time: steps[1], playing: false, speed: 1 as const,
  onTime: vi.fn(), onStep: vi.fn(), onPlay: vi.fn(), onPause: vi.fn(), onSpeed: vi.fn(),
});

describe('TimeSliderView', () => {
  it('names the slider and writes the value in local dd/MM/yyyy HH:mm', () => {
    render(<TimeSliderView {...props()} />);
    const s = screen.getByRole('slider', { name: 'Thời điểm' });
    const d = new Date(steps[1]);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(s).toHaveAttribute('aria-valuetext', `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
  });

  it('arrow keys step back and forward', async () => {
    const p = props();
    render(<TimeSliderView {...p} />);
    screen.getByRole('slider', { name: 'Thời điểm' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(p.onStep).toHaveBeenLastCalledWith(1);
    await userEvent.keyboard('{ArrowLeft}');
    expect(p.onStep).toHaveBeenLastCalledWith(-1);
  });

  it('play, pause and speed buttons call back', async () => {
    const p = props();
    const { rerender } = render(<TimeSliderView {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Phát' }));
    expect(p.onPlay).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '2×' }));
    expect(p.onSpeed).toHaveBeenCalledWith(2);
    rerender(<TimeSliderView {...p} playing />);
    await userEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(p.onPause).toHaveBeenCalled();
  });
});
