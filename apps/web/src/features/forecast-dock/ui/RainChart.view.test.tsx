import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RainChartView } from './RainChart.view';
import { runningTotals } from '../model/rain';

const DAYS = [
  { date: '2025-10-25', mm: 12.5 }, { date: '2025-10-26', mm: 140 }, { date: '2025-10-27', mm: 310.2 },
];

describe('RainChartView', () => {
  it('summarises the total and the wettest day', () => {
    render(<RainChartView days={DAYS} source="MSWEP (GloH2O)" sample />);
    const fig = screen.getByRole('figure', { name: 'Mưa lưu vực theo ngày' });
    expect(within(fig).getByText('Tổng 462,7 mm trong 3 ngày, nhiều nhất 310,2 mm ngày 27/10.')).toBeInTheDocument();
    expect(within(fig).getByText('MẪU')).toBeInTheDocument();
  });

  it('draws one bar per day on a single mm axis', () => {
    const { container } = render(<RainChartView days={DAYS} source="s" />);
    expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(1);
    expect([...container.querySelectorAll('svg text')].map((t) => t.textContent)).toContain('mm');
  });

  it('lists daily rain and the running total in its table', async () => {
    render(<RainChartView days={DAYS} source="s" />);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Bảng' }));
    const rows = within(screen.getByRole('table', { name: 'Mưa lưu vực theo ngày' })).getAllByRole('row');
    expect(rows[3]).toHaveTextContent('27/10/2025310,2462,7');
  });

  it('keeps a running total', () => {
    expect(runningTotals(DAYS)).toEqual([12.5, 152.5, 462.7]);
  });
});
