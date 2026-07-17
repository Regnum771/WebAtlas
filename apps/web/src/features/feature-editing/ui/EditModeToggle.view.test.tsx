import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditModeToggleView } from './EditModeToggle.view';

describe('EditModeToggleView', () => {
  it('shows "Edit existing" when off and calls onEnter', async () => {
    const onEnter = vi.fn();
    render(<EditModeToggleView editMode={false} onEnter={onEnter} onExit={vi.fn()} hint="" />);
    await userEvent.click(screen.getByRole('button', { name: /edit existing/i }));
    expect(onEnter).toHaveBeenCalled();
  });

  it('shows exit + hint when on and calls onExit', async () => {
    const onExit = vi.fn();
    render(<EditModeToggleView editMode onEnter={vi.fn()} onExit={onExit} hint="Click a feature to edit" />);
    expect(screen.getByText('Click a feature to edit')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /exit edit/i }));
    expect(onExit).toHaveBeenCalled();
  });
});
