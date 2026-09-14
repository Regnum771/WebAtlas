import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconRail, type RailItem } from './IconRail.view';

const items: RailItem[] = [
  { id: 'layers', label: 'Lớp dữ liệu' },
  { id: 'legend', label: 'Chú giải' },
];

describe('IconRail', () => {
  it('renders a button per item with an accessible label', () => {
    render(<IconRail items={items} active={null} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Lớp dữ liệu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chú giải' })).toBeInTheDocument();
  });

  it('marks the active item as pressed', () => {
    render(<IconRail items={items} active="legend" onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Chú giải' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Lớp dữ liệu' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToggle with the item id', async () => {
    const onToggle = vi.fn();
    render(<IconRail items={items} active={null} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chú giải' }));
    expect(onToggle).toHaveBeenCalledWith('legend');
  });
});
