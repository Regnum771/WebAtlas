import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../features/map/ui/MapView', () => ({ default: () => <div>MAP_VIEW</div> }));
vi.mock('../components/LayerTree', () => ({ default: () => <div>LAYER_TREE</div> }));
vi.mock('../components/DynamicLegend', () => ({ default: () => <div>LEGEND</div> }));
vi.mock('../components/DynamicPopup', () => ({ default: () => <div>POPUP</div> }));
vi.mock('../components/OGCClient', () => ({ default: () => <div>OGC</div> }));
vi.mock('../components/MapControls', () => ({ default: () => <div>CONTROLS</div> }));
vi.mock('../components/SearchBar', () => ({ default: () => <div>SEARCH</div> }));
vi.mock('../widgets/top-bar', () => ({ default: () => <div>TOP_BAR</div> }));
vi.mock('../features/shell', () => ({ default: () => <div>SHELL</div> }));
vi.mock('../pages/admin-users', () => ({ default: () => <div>ADMIN_USERS</div> }));

import App from './App';

describe('App routing', () => {
  it('renders the map and no admin route at /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
    expect(screen.queryByText('ADMIN_USERS')).not.toBeInTheDocument();
  });

  it('renders the admin route at /admin/users', () => {
    window.history.pushState({}, '', '/admin/users');
    render(<App />);
    expect(screen.getByText('ADMIN_USERS')).toBeInTheDocument();
  });

  it('KEEPS THE MAP MOUNTED at /admin/users (map is a sibling of Routes)', () => {
    window.history.pushState({}, '', '/admin/users');
    render(<App />);
    // This is the whole point of the sibling arrangement: OpenLayers must not
    // re-initialize and the user's center/zoom must survive navigation.
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
  });
});
