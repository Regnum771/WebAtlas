import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mutable box so each test can drive a different layersState through the
// same mocked useMapContext.
let mockLayersState: { id: string; visible: boolean; opacity: number }[] = [];
vi.mock('../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ layersState: mockLayersState }),
}));

import Legend from './index';

const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';

describe('Legend composition (real layersState -> LEGEND_ATTRIBUTION derivation)', () => {
  it('renders OSM attribution for lakes when rivers is hidden — the previously-shipped bug', () => {
    mockLayersState = [
      { id: 'layer_lakes', visible: true, opacity: 1 },
      { id: 'layer_rivers', visible: false, opacity: 1 },
    ];
    render(<Legend />);
    expect(screen.getByText(OSM_ATTRIBUTION)).toBeInTheDocument();
  });

  it('renders OSM attribution for rivers when lakes is hidden', () => {
    mockLayersState = [
      { id: 'layer_rivers', visible: true, opacity: 1 },
      { id: 'layer_lakes', visible: false, opacity: 1 },
    ];
    render(<Legend />);
    expect(screen.getByText(OSM_ATTRIBUTION)).toBeInTheDocument();
  });

  it('renders one attribution per OSM-sourced layer when both are visible', () => {
    mockLayersState = [
      { id: 'layer_rivers', visible: true, opacity: 1 },
      { id: 'layer_lakes', visible: true, opacity: 1 },
    ];
    render(<Legend />);
    expect(screen.getAllByText(OSM_ATTRIBUTION)).toHaveLength(2);
  });

  it('renders no OSM attribution when only a non-OSM layer is visible', () => {
    mockLayersState = [{ id: 'layer_dams', visible: true, opacity: 1 }];
    render(<Legend />);
    expect(screen.queryByText(/OpenStreetMap/)).not.toBeInTheDocument();
  });
});
