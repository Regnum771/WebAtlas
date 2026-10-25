import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DICTIONARY, attributeOf } from '@webatlas/shared';
import { ProfileChartView } from './ProfileChart.view';

const DEM = attributeOf(DICTIONARY, 'dem', '1')!;
const DEM_CM = { ...DEM, displayUnit: 'cm' };

describe('ProfileChartView', () => {
  it('draws one polyline point per sample with data and labels the range', () => {
    const { container } = render(
      <ProfileChartView profile={[
        { distanceM: 0, elevationM: 400 }, { distanceM: 500, elevationM: null }, { distanceM: 1000, elevationM: 520 },
      ]} elevation={DEM} />
    );
    const points = container.querySelector('polyline')!.getAttribute('points')!.trim().split(/\s+/);
    expect(points).toHaveLength(2);
    const axis = container.querySelector('figcaption')!;
    expect(axis).toHaveTextContent('520 m');
    expect(axis).toHaveTextContent('400 m');
    expect(axis).toHaveTextContent('1 km');
  });

  it('the profile axis and tooltip use the dem display unit', () => {
    const { container } = render(
      <ProfileChartView profile={[{ distanceM: 0, elevationM: 400 }, { distanceM: 1000, elevationM: 520 }]} elevation={DEM_CM} />
    );
    const axis = container.querySelector('figcaption')!;
    expect(axis).toHaveTextContent('52.000 cm');
    expect(axis).toHaveTextContent('40.000 cm');
    expect([...container.querySelectorAll('title')].map((t) => t.textContent)).toEqual(['40.000 cm', '52.000 cm']);
  });

  it('renders nothing without data', () => {
    const { container } = render(<ProfileChartView profile={[{ distanceM: 0, elevationM: null }]} elevation={DEM} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
