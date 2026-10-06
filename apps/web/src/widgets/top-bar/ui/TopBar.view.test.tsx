import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TopBarView, type TopBarViewProps } from './TopBar.view';

const base: TopBarViewProps = {
  nav: [{ to: '/', label: 'Bản đồ' }],
  search: <div>SEARCH_SLOT</div>,
  assistant: null,
  account: <div>ACCOUNT_SLOT</div>,
};
const ui = (props: Partial<TopBarViewProps> = {}) => (
  <MemoryRouter initialEntries={['/']}><TopBarView {...base} {...props} /></MemoryRouter>
);

describe('TopBarView', () => {
  it('shows the wordmark as a link home, the navigation and the search slot', () => {
    render(ui());
    expect(screen.getByRole('link', { name: 'WebATLAS' })).toHaveAttribute('href', '/');
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(nav).toHaveTextContent('Bản đồ');
    expect(screen.getByText('SEARCH_SLOT')).toBeInTheDocument();
    expect(screen.getByText('ACCOUNT_SLOT')).toBeInTheDocument();
  });

  it('marks the current screen', () => {
    render(ui());
    expect(screen.getByRole('link', { name: 'Bản đồ' })).toHaveAttribute('aria-current', 'page');
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
