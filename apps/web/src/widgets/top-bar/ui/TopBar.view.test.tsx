import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TopBarView, type TopBarViewProps } from './TopBar.view';

const base: TopBarViewProps = {
  nav: [{ kind: 'route', to: '/ban-do', label: 'Bản đồ' }],
  search: <div>SEARCH_SLOT</div>,
  assistant: null,
  account: <div>ACCOUNT_SLOT</div>,
};
const ui = (props: Partial<TopBarViewProps> = {}, at = '/ban-do') => (
  <MemoryRouter initialEntries={[at]}><TopBarView {...base} {...props} /></MemoryRouter>
);

describe('TopBarView', () => {
  it('shows the wordmark as a link to the hub, the navigation and the search slot', () => {
    render(ui());
    expect(screen.getByRole('link', { name: 'WebATLAS' })).toHaveAttribute('href', '/');
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(nav).toHaveTextContent('Bản đồ');
    expect(screen.getByText('SEARCH_SLOT')).toBeInTheDocument();
    expect(screen.getByText('ACCOUNT_SLOT')).toBeInTheDocument();
  });

  it('marks the current screen, and nothing on the hub', () => {
    const { unmount } = render(ui());
    expect(screen.getByRole('link', { name: 'Bản đồ' })).toHaveAttribute('aria-current', 'page');
    unmount();
    render(ui({}, '/'));
    expect(screen.getByRole('link', { name: 'Bản đồ' })).not.toHaveAttribute('aria-current');
  });

  it('opens another platform service in a new tab and marks one that is down', () => {
    render(ui({ nav: [
      { kind: 'link', href: 'http://localhost:8000/', label: 'Danh mục', down: false },
      { kind: 'link', href: 'http://localhost:3070/', label: 'Điều phối', down: true },
    ] }));
    const catalogue = screen.getByRole('link', { name: /Danh mục/ });
    expect(catalogue).toHaveAttribute('href', 'http://localhost:8000/');
    expect(catalogue).toHaveAttribute('target', '_blank');
    expect(catalogue).toHaveAttribute('rel', 'noopener noreferrer');
    expect(catalogue).not.toHaveClass('is-down');
    const ops = screen.getByRole('link', { name: /Điều phối/ });
    expect(ops).toHaveClass('is-down');
    expect(ops).toHaveAttribute('title', 'Điều phối: không kết nối được');
  });

  it('shows no Trợ lý button when given none', () => {
    render(ui({ assistant: null }));
    expect(screen.queryByRole('button', { name: 'Trợ lý' })).toBeNull();
  });

  it('Trợ lý reports its open state', async () => {
    const onToggle = vi.fn();
    const { rerender } = render(ui({ assistant: { open: false, onToggle } }));
    const button = screen.getByRole('button', { name: 'Trợ lý' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(ui({ assistant: { open: true, onToggle } }));
    expect(screen.getByRole('button', { name: 'Trợ lý' })).toHaveAttribute('aria-pressed', 'true');
  });
});
