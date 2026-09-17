import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProfileChartView } from './ProfileChart.view';

describe('ProfileChartView', () => {
  it('draws one polyline point per sample with data and labels the range', () => {
    const { container, getByText } = render(
      <ProfileChartView profile={[
        { distanceM: 0, elevationM: 400 }, { distanceM: 500, elevationM: null }, { distanceM: 1000, elevationM: 520 },
      ]} />
    );
    const points = container.querySelector('polyline')!.getAttribute('points')!.trim().split(/\s+/);
    expect(points).toHaveLength(2);
    expect(getByText('520 m')).toBeInTheDocument();
    expect(getByText('400 m')).toBeInTheDocument();
    expect(getByText('1 km')).toBeInTheDocument();
  });

  it('renders nothing without data', () => {
    const { container } = render(<ProfileChartView profile={[{ distanceM: 0, elevationM: null }]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
