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

describe('LegendView in the contents panel', () => {
  it('is a converted scope with one block per layer, and links an OpenStreetMap notice to its source', () => {
    const { container } = render(
      <LegendView
        layers={[
          { layerStateId: 'layer_lakes', name: 'Hồ', sections: [{ title: 'Mặt nước', entries: [{ swatch: '#60a5fa', shape: 'box', label: 'Hồ' }] }], attribution: '© OpenStreetMap contributors (ODbL)' },
          { layerStateId: 'layer_contours', name: 'Đường đồng mức', sections: [], attribution: 'FABDEM' },
        ]}
      />
    );
    expect(screen.getByRole('region', { name: 'Chú giải' })).toHaveAttribute('data-slot', 'legend');
    expect(container.querySelectorAll('[data-legend-layer]')).toHaveLength(2);
    expect(screen.getByRole('link', { name: '© OpenStreetMap contributors (ODbL)' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    expect(screen.getByText('FABDEM').closest('a')).toBeNull();
  });
});
