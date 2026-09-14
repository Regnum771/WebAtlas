import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LegendView } from './Legend.view';

describe('LegendView', () => {
  it('renders nothing when no layers are visible', () => {
    const { container } = render(<LegendView layers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a section title and its entry labels', () => {
    render(
      <LegendView
        layers={[
          {
            layerStateId: 'layer_rivers',
            name: 'Sông ngòi',
            sections: [{ title: 'Sông ngòi', entries: [{ swatch: '#3b82f6', shape: 'line', label: 'Dòng chảy' }] }],
          },
        ]}
      />
    );
    expect(screen.getByText('Dòng chảy')).toBeInTheDocument();
  });

  it('renders the licence attribution when present', () => {
    render(
      <LegendView
        layers={[
          {
            layerStateId: 'layer_lakes',
            name: 'Hồ',
            sections: [{ title: 'Hồ', entries: [{ swatch: '#60a5fa', shape: 'box', label: 'Mặt nước' }] }],
            attribution: '© OpenStreetMap contributors (ODbL)',
          },
        ]}
      />
    );
    expect(screen.getByText('© OpenStreetMap contributors (ODbL)')).toBeInTheDocument();
  });
});
