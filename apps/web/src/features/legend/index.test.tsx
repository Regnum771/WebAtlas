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
// Câu ghi công FABDEM bắt buộc theo giấy phép CC BY-NC-SA — nguyên văn giống hệt
// CONTOUR_ATTRIBUTION trong contours.ts và LEGEND_ATTRIBUTION.layer_contours.
const FABDEM_ATTRIBUTION =
  'FABDEM is produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018';

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

describe('Legend composition — FABDEM attribution (C1: the licence obligation, not just the constant)', () => {
  // C1: the map has no ol/control/Attribution (deliberately — see MapModel.ts:368-370),
  // so a source's `attributions` string is never rendered anywhere on the map itself.
  // A test asserting `source.getAttributions()` (MapModel.test.ts) proves the constant is
  // attached to a source, not that a user ever sees it — it was green while the licence
  // obligation was unmet. This test renders the actual legend output, the one place the
  // notice reaches a user, and must fail if `LEGEND_ATTRIBUTION.layer_contours` is ever
  // removed or the Legend component stops rendering it.
  it('renders the FABDEM notice when the contour layer is visible', () => {
    mockLayersState = [{ id: 'layer_contours', visible: true, opacity: 1 }];
    render(<Legend />);
    expect(screen.getByText(FABDEM_ATTRIBUTION)).toBeInTheDocument();
  });

  it('renders no FABDEM notice when the contour layer is hidden', () => {
    mockLayersState = [{ id: 'layer_contours', visible: false, opacity: 1 }];
    render(<Legend />);
    expect(screen.queryByText(FABDEM_ATTRIBUTION)).not.toBeInTheDocument();
  });
});
