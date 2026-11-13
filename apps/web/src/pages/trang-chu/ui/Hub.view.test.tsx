import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HubView, type HubViewProps } from './Hub.view';
import type { HubTile } from '../model/hubTiles';
import type { CatalogueItem } from '../../../features/catalogue/api/catalogue.api';

const tiles: HubTile[] = [
  { id: 'ban-do', kind: 'route', to: '/ban-do', title: 'Bản đồ tương tác', text: 'Xem, phân tích, in bản đồ.' },
  { id: 'geonode', kind: 'service', href: 'http://localhost:8000/', title: 'Danh mục bản đồ', text: 'Tập dữ liệu.', state: 'ready' },
  { id: 'dagster', kind: 'service', href: 'http://localhost:3070/', title: 'Điều phối dữ liệu', text: 'Luồng dữ liệu.', state: 'down' },
  { id: 'du-lieu', kind: 'route', to: '/du-lieu', title: 'Từ điển dữ liệu', text: 'Định nghĩa lớp.' },
  { id: 'ho-so', kind: 'route', to: '/ho-so', title: 'Hồ sơ', text: 'Tài khoản.' },
];

const item = (over: Partial<CatalogueItem>): CatalogueItem => ({
  id: '1', kind: 'raster', title: 'Ảnh vệ tinh', abstract: '', managingUnit: 'VN', isPublished: true, mine: false,
  variable: null, unit: null, timeSteps: null, bbox4326: null, layerName: 'geonode:x', updatedAt: '2026-11-12T13:25:00Z',
  ...over,
} as CatalogueItem);

const ui = (props: Partial<HubViewProps> = {}) => (
  <MemoryRouter><HubView tiles={tiles} recent={{ status: 'ok', items: [] }} {...props} /></MemoryRouter>
);

describe('HubView hero', () => {
  it('is a converted scope with the WebATLAS title, Mở bản đồ and Danh mục', () => {
    const { container } = render(ui());
    expect(container.querySelector('[data-slot="hub"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'WebATLAS' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mở bản đồ' })).toHaveAttribute('href', '/ban-do');
    const cat = screen.getByRole('link', { name: 'Danh mục (mở thẻ mới)' });
    expect(cat).toHaveAttribute('href', 'http://localhost:8000/');
    expect(cat).toHaveAttribute('target', '_blank');
  });

  it('offers no Danh mục button when the catalogue is not connected', () => {
    render(ui({ tiles: tiles.map((t) => (t.id === 'geonode' ? { ...t, href: null, state: 'unconfigured' } as HubTile : t)) }));
    expect(screen.queryByRole('link', { name: 'Danh mục (mở thẻ mới)' })).toBeNull();
  });

  it('stacks the four layers bottom to top and names each with its source', () => {
    const { container } = render(ui());
    const stack = screen.getByRole('figure', { name: /Bốn lớp của WebATLAS/ });
    expect(Array.from(container.querySelectorAll('[data-layer]')).map((e) => (e as HTMLElement).dataset.layer))
      .toEqual(['terrain', 'basemap', 'rivers', 'flood']);
    const labels = within(stack).getAllByRole('listitem').map((li) => li.textContent);
    expect(labels).toEqual([
      'Địa hìnhFABDEM, đường đồng mức', 'Nền bản đồOpenStreetMap', 'Sông ngòiOpenStreetMap', 'Độ sâu ngậpHEC-RAS 2D, 10/2025',
    ]);
  });

  it('holds still when the reader asks for reduced motion: every animation has its motion-reduce stop', () => {
    const { container } = render(ui());
    const animated = Array.from(container.querySelectorAll('[class*="animate-"]'));
    expect(animated.length).toBeGreaterThanOrEqual(6);
    for (const el of animated) expect(el.getAttribute('class')).toContain('motion-reduce:animate-none');
    expect(screen.getByRole('figure').getAttribute('class')).toContain('motion-reduce:hover:[--gap:48px]');
  });

  it('shows the replay line, linking to the map', () => {
    render(ui());
    expect(screen.getByRole('link', { name: 'PHÁT LẠI 10/2025' })).toHaveAttribute('href', '/ban-do');
    expect(screen.getByText('Nguồn: HEC-RAS 2D, MSWEP, KTTV')).toBeInTheDocument();
  });
});

describe('HubView service panels', () => {
  it('draws Bản đồ, Danh mục and Điều phối as panels, in order, each with a status tag', () => {
    render(ui());
    const services = screen.getByRole('region', { name: 'Dịch vụ' });
    const panels = within(services).getAllByRole('listitem');
    expect(panels.map((p) => p.textContent)).toEqual([
      expect.stringContaining('Bản đồ tương tác') as unknown as string,
      expect.stringContaining('Danh mục bản đồ') as unknown as string,
      expect.stringContaining('Điều phối dữ liệu') as unknown as string,
    ]);
    expect(panels[0]).toHaveTextContent('Hoạt động');
    expect(panels[1]).toHaveTextContent('Hoạt động');
    expect(panels[2]).toHaveTextContent('Không kết nối được');
  });

  it('names every state', () => {
    for (const [state, text] of [['checking', 'Đang kiểm tra'], ['unconfigured', 'Chưa kết nối']] as const) {
      const { unmount } = render(ui({ tiles: [{ ...tiles[1], state } as HubTile] }));
      expect(screen.getByRole('region', { name: 'Dịch vụ' })).toHaveTextContent(text);
      unmount();
    }
  });

  it('keeps a service that is down a link, and an unconnected one not', () => {
    const { unmount } = render(ui());
    expect(screen.getByRole('link', { name: /Điều phối dữ liệu/ })).toHaveAttribute('href', 'http://localhost:3070/');
    unmount();
    render(ui({ tiles: [{ ...tiles[2], href: null, state: 'unconfigured' } as HubTile] }));
    expect(screen.queryByRole('link', { name: /Điều phối dữ liệu/ })).toBeNull();
  });

  it('lists the other areas as shortcuts', () => {
    render(ui());
    const nav = screen.getByRole('navigation', { name: 'Lối tắt' });
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/du-lieu', '/ho-so']);
  });
});

describe('HubView Mới cập nhật', () => {
  it('lists title, kind and date, and marks an entry not yet approved', () => {
    render(ui({ recent: { status: 'ok', items: [item({}), item({ id: '2', title: 'Độ sâu ngập', kind: 'timeseries', isPublished: false })] }}));
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Ảnh vệ tinhRaster12/11/2026');
    expect(rows[1]).toHaveTextContent('Độ sâu ngậpChưa duyệtChuỗi thời gian');
  });

  it('says so while loading, when empty, and when the request failed, with a retry', async () => {
    const { rerender } = render(ui({ recent: { status: 'loading' } }));
    expect(screen.getByText('Đang tải…')).toBeInTheDocument();
    rerender(ui({ recent: { status: 'ok', items: [] } }));
    expect(screen.getByText('Chưa có mục nào bạn xem được.')).toBeInTheDocument();
    const retry = vi.fn();
    rerender(ui({ recent: { status: 'error', retry } }));
    expect(screen.getByRole('status')).toHaveTextContent('Không tải được Danh mục.');
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
