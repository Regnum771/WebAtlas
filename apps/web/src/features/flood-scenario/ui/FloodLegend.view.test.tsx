import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FloodLegendView } from './FloodLegend.view';

describe('FloodLegendView', () => {
  it('shows one labelled swatch per depth band', () => {
    const { container } = render(<FloodLegendView planShown={false} />);
    for (const label of ['< 0,5 m', '0,5–1 m', '1–2 m', '2–3 m', '≥ 3 m']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelectorAll('.flood-legend-band')).toHaveLength(5);
  });

  it('tells the reader to point at the map for the exact depth', () => {
    render(<FloodLegendView planShown={false} />);
    expect(screen.getByText(/Trỏ chuột vào vùng ngập/)).toBeInTheDocument();
  });
});
