import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HubView } from './Hub.view';
import type { HubTile } from '../model/hubTiles';

const tiles: HubTile[] = [
  { id: 'ban-do', kind: 'route', to: '/ban-do', title: 'Bản đồ tương tác', text: 'x' },
  { id: 'geonode', kind: 'service', href: 'http://localhost:8000/', title: 'Danh mục bản đồ', text: 'y', state: 'ready' },
  { id: 'dagster', kind: 'service', href: 'http://localhost:3070/', title: 'Điều phối dữ liệu', text: 'z', state: 'down' },
  { id: 'keycloak', kind: 'service', href: null, title: 'Khác', text: 'w', state: 'unconfigured' },
];

describe('HubView', () => {
  it('links routes in-app and services in a new tab', () => {
    render(<MemoryRouter><HubView tiles={tiles} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Bản đồ tương tác/ })).toHaveAttribute('href', '/ban-do');
    const catalogue = screen.getByRole('link', { name: /Danh mục bản đồ/ });
    expect(catalogue).toHaveAttribute('href', 'http://localhost:8000/');
    expect(catalogue).toHaveAttribute('target', '_blank');
  });

  it('keeps a service that is down as a link with the reason, and an unconfigured one as no link', () => {
    render(<MemoryRouter><HubView tiles={tiles} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Điều phối dữ liệu/ })).toHaveTextContent('Không kết nối được');
    expect(screen.queryByRole('link', { name: /Khác/ })).toBeNull();
    expect(screen.getByText('Chưa kết nối')).toBeInTheDocument();
  });

  it('says nothing about the state of a service that is up', () => {
    render(<MemoryRouter><HubView tiles={tiles.slice(0, 2)} /></MemoryRouter>);
    expect(screen.queryByText(/kết nối/)).toBeNull();
  });
});
