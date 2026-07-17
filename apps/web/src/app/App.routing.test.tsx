import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Stub the heavy map + children so this test is about ROUTING only.
vi.mock('../features/map/ui/MapView', () => ({ default: () => <div>MAP_VIEW</div> }));
vi.mock('../components/LayerTree', () => ({ default: () => <div>LAYER_TREE</div> }));
vi.mock('../components/BasemapSwitcher', () => ({ default: () => <div>BASEMAP</div> }));
vi.mock('../components/DynamicLegend', () => ({ default: () => <div>LEGEND</div> }));
vi.mock('../components/DynamicPopup', () => ({ default: () => <div>POPUP</div> }));
vi.mock('../components/OGCClient', () => ({ default: () => <div>OGC</div> }));
vi.mock('../components/MapControls', () => ({ default: () => <div>CONTROLS</div> }));
vi.mock('../components/SearchBar', () => ({ default: () => <div>SEARCH</div> }));
vi.mock('../features/auth', () => ({ default: () => <div>AUTH_WIDGET</div> }));
vi.mock('../features/shell', () => ({ default: () => <div>SHELL</div> }));

import App from './App';

describe('App routing', () => {
  it('renders the map at /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
  });

  it('keeps the map mounted on a non-root route (map is a sibling of Routes)', () => {
    window.history.pushState({}, '', '/admin/users');
    render(<App />);
    // The map must NOT unmount just because the URL changed.
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
  });
});
