import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterButtonView } from './FilterButton.view';

describe('FilterButtonView', () => {
  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<FilterButtonView activeCount={0} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: /lọc/i }));
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows the active-condition count when > 0', () => {
    render(<FilterButtonView activeCount={2} onToggle={vi.fn()} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows no badge when count is 0', () => {
    render(<FilterButtonView activeCount={0} onToggle={vi.fn()} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
