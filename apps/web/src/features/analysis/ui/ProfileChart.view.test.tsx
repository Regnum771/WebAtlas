import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DICTIONARY, attributeOf } from '@webatlas/shared';
import { ProfileChartView } from './ProfileChart.view';

const DEM = attributeOf(DICTIONARY, 'dem', '1')!;
const DEM_CM = { ...DEM, displayUnit: 'cm' };
const PROFILE = [
  { distanceM: 0, elevationM: 400 }, { distanceM: 500, elevationM: null }, { distanceM: 1000, elevationM: 520 },
];

describe('ProfileChartView', () => {
  it('is a named figure whose summary gives the length and the elevation range', () => {
    render(<ProfileChartView profile={PROFILE} elevation={DEM} />);
    const fig = screen.getByRole('figure', { name: 'Trắc diện độ cao' });
    expect(within(fig).getByText('Trắc diện dài 1 km, độ cao từ 400 m đến 520 m.')).toBeInTheDocument();
    expect(within(fig).getByText(/^Nguồn:/)).toBeInTheDocument();
  });

  it('draws the samples with data, with distance and elevation axes in their units', () => {
    const { container } = render(<ProfileChartView profile={PROFILE} elevation={DEM} />);
    expect(container.querySelector('.recharts-area')).not.toBeNull();
    const texts = [...container.querySelectorAll('svg text')].map((t) => t.textContent);
    expect(texts).toContain('m');
    expect(texts.some((t) => t?.endsWith(' km'))).toBe(true);
  });

  it('lists the samples in its table view, in the dem display unit', async () => {
    render(<ProfileChartView profile={PROFILE} elevation={DEM_CM} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Bảng' }));
    const table = screen.getByRole('table', { name: 'Trắc diện độ cao' });
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Khoảng cách (km)', 'Độ cao (cm)']);
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows).toEqual(['040.000', '152.000']);
  });

  it('renders nothing without two samples with data', () => {
    const { container } = render(<ProfileChartView profile={[{ distanceM: 0, elevationM: null }]} elevation={DEM} />);
    expect(container.querySelector('figure')).toBeNull();
  });
});
