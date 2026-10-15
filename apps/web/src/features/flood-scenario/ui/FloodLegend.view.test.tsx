import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FloodLegendView } from './FloodLegend.view';

describe('FloodLegendView', () => {
  it('places each depth tick where that depth sits on the linear 0-4 m ramp', () => {
    const { container } = render(<FloodLegendView planShown={false} />);
    const ticks = [...container.querySelectorAll<HTMLElement>('.flood-legend-ticks span')];
    expect(ticks.map((t) => [t.textContent, t.style.left])).toEqual([
      ['0', '0%'], ['0,5', '12.5%'], ['1', '25%'], ['2', '50%'], ['≥ 4', '100%'],
    ]);
  });
});
