import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';

vi.mock('../features/map/ui/MapView', () => ({ default: () => <div>MAP_VIEW</div> }));
vi.mock('../components/DynamicPopup', () => ({ default: () => <div>POPUP</div> }));
vi.mock('../features/map/ui/MapLoadingBar', () => ({ default: () => null }));
vi.mock('../features/layers-panel', () => ({ default: () => <div>LAYERS</div> }));
vi.mock('../features/legend', () => ({ default: () => <div>LEGEND</div> }));
vi.mock('../features/assistant', () => ({ default: () => <div>ASSISTANT</div> }));
vi.mock('../features/analysis', () => ({ useAnalysisTools: () => ({ buttons: null, panel: null }) }));
vi.mock('../features/roi/ui/RoiChip', () => ({ default: () => null }));
vi.mock('../features/roi/ui/RoiDrawButtons', () => ({ default: () => null }));
vi.mock('../features/feature-editing/ProposedEdit', () => ({ default: () => null }));
vi.mock('../entities/admin-unit/adminUnits.store', () => ({ primeAdminUnits: vi.fn(() => Promise.resolve()) }));
vi.mock('../widgets/top-bar', () => ({ default: () => <div>TOP_BAR</div> }));
vi.mock('../pages/quan-ly', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <div>QUAN_LY<Outlet /></div> };
});
vi.mock('../pages/quan-ly/sections/NguoiDung', () => ({ default: () => <div>NGUOI_DUNG</div> }));
vi.mock('../pages/quan-ly/sections/NhomQuyen', () => ({ default: () => <div>NHOM_QUYEN</div> }));
vi.mock('../pages/quan-ly/sections/ChuaGan', () => ({ default: () => <div>CHUA_GAN</div> }));

vi.mock('../pages/du-lieu', () => ({ default: () => <div>DU_LIEU</div> }));

import App from './App';

describe('App routing', () => {
  it('renders the map and no Quản lý area at /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
    expect(screen.queryByText('QUAN_LY')).not.toBeInTheDocument();
  });

  it('renders the Người dùng section at /quan-ly/nguoi-dung', async () => {
    window.history.pushState({}, '', '/quan-ly/nguoi-dung');
    render(<App />);
    expect(await screen.findByText('NGUOI_DUNG')).toBeInTheDocument();
    expect(screen.getByText('QUAN_LY')).toBeInTheDocument();
  });

  it('/admin/users redirects to /quan-ly/nguoi-dung', async () => {
    window.history.pushState({}, '', '/admin/users');
    render(<App />);
    expect(await screen.findByText('NGUOI_DUNG')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/quan-ly/nguoi-dung');
  });

  it('KEEPS THE MAP MOUNTED in Quản lý (map is a sibling of Routes)', async () => {
    window.history.pushState({}, '', '/quan-ly/nhom-quyen');
    render(<App />);
    expect(await screen.findByText('NHOM_QUYEN')).toBeInTheDocument();
    // OpenLayers must not re-initialize and the user's center/zoom must survive navigation.
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
  });

  it('/du-lieu overlays a live map', async () => {
    window.history.pushState({}, '', '/du-lieu');
    render(<App />);
    expect(await screen.findByText('DU_LIEU')).toBeInTheDocument();
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
  });

  it('the du-lieu pages are lazy-loaded', () => {
    const source = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8');
    const lines = source.split('\n').filter((line) => line.includes('pages/du-lieu'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/lazy\(\(\) => import\('/);
  });

  it('the Quản lý chunk is not in the main bundle', () => {
    const source = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8');
    const lines = source.split('\n').filter((line) => line.includes('pages/quan-ly'));
    expect(lines.length).toBeGreaterThan(0);
    // Every reference must be a dynamic import inside lazy(); a static import would pull it into the main chunk.
    for (const line of lines) expect(line).toMatch(/lazy\(\(\) => import\('/);
    expect(source).not.toMatch(/^import .*pages\/quan-ly/m);
  });
});
