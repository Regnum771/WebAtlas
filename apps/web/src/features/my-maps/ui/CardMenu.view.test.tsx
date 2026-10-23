import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardMenuView } from './CardMenu.view';

const items = (a = vi.fn(), b = vi.fn()) => [
  { label: 'Chia sẻ', onSelect: a },
  { label: 'Xoá bản đồ', onSelect: b, danger: true },
];

describe('CardMenuView', () => {
  it('opens below the ⋯ button and runs a choice, then closes', async () => {
    const a = vi.fn();
    const user = userEvent.setup();
    render(<CardMenuView items={items(a)} />);
    const button = screen.getByRole('button', { name: 'Thao tác khác' });
    expect(button).toHaveTextContent('⋯');
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(button);
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Chia sẻ', 'Xoá bản đồ']);
    await user.click(screen.getByRole('menuitem', { name: 'Chia sẻ' }));
    expect(a).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and returns focus to the button', async () => {
    const user = userEvent.setup();
    render(<CardMenuView items={items()} />);
    const button = screen.getByRole('button', { name: 'Thao tác khác' });
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('closes on an outside click', async () => {
    const user = userEvent.setup();
    render(<div><p>ngoài</p><CardMenuView items={items()} /></div>);
    await user.click(screen.getByRole('button', { name: 'Thao tác khác' }));
    await user.click(screen.getByText('ngoài'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('arrow keys move focus between the items', async () => {
    const user = userEvent.setup();
    render(<CardMenuView items={items()} />);
    await user.click(screen.getByRole('button', { name: 'Thao tác khác' }));
    const [first, second] = screen.getAllByRole('menuitem');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(second).toHaveFocus();
  });
});
