import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({
    setMap: vi.fn(),
    setBusy: vi.fn(),
    basemap: 'street',
    layersState: [],
    reservoirFilter: 'all',
  }),
}));

vi.mock('../model/mapEditing', () => ({
  useMapEditing: () => ({ registerRefresh: vi.fn(), registerSetSelectActive: vi.fn() }),
}));

const updateSize = vi.fn();
const init = vi.fn();
vi.mock('../model/MapModel', () => ({
  MapModel: vi.fn().mockImplementation(() => ({
    init,
    getMap: () => null,
    updateSize,
    setLoadingListener: vi.fn(),
    dispose: vi.fn(),
    applyLayerStates: vi.fn(),
    setBasemap: vi.fn(),
    setReservoirFilter: vi.fn(),
  })),
}));

import MapView from './MapView';

describe('MapView flyout inset', () => {
  beforeEach(() => {
    updateSize.mockClear();
    init.mockClear();
  });

  it('adds the flyout-open modifier class when a flyout is open', () => {
    const { container } = render(<MapView flyoutOpen />);
    expect(container.querySelector('.map-container')?.className).toContain('flyout-open');
  });

  it('does not add the flyout-open modifier class when no flyout is open', () => {
    const { container } = render(<MapView flyoutOpen={false} />);
    expect(container.querySelector('.map-container')?.className).not.toContain('flyout-open');
  });

  it('calls model.updateSize() once the container finishes its inset transition', () => {
    const { container } = render(<MapView flyoutOpen={false} />);
    updateSize.mockClear(); // drop any call made at mount
    const el = container.querySelector('.map-container')!;
    act(() => {
      el.dispatchEvent(new Event('transitionend', { bubbles: true }));
    });
    expect(updateSize).toHaveBeenCalled();
  });

  it('calls model.updateSize() on a flyoutOpen change even without a transitionend event (no-motion fallback)', () => {
    const { container, rerender } = render(<MapView flyoutOpen={false} />);
    updateSize.mockClear();
    rerender(<MapView flyoutOpen={true} />);
    expect(container.querySelector('.map-container')).toBeTruthy();
    expect(updateSize).toHaveBeenCalled();
  });
});
