import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonaRailView } from './PersonaRail.view';

const workspaces = [
  { id: 'governance' as const, label: 'Governance' },
  { id: 'research' as const, label: 'Research' },
];

describe('PersonaRailView', () => {
  it('renders a button per workspace and marks the active one', () => {
    render(<PersonaRailView workspaces={workspaces} activeId="research" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /governance/i })).toBeInTheDocument();
    const active = screen.getByRole('button', { name: /research/i });
    expect(active).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect with the workspace id', async () => {
    const onSelect = vi.fn();
    render(<PersonaRailView workspaces={workspaces} activeId="governance" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /research/i }));
    expect(onSelect).toHaveBeenCalledWith('research');
  });

  it('renders nothing when there are no workspaces (anonymous)', () => {
    const { container } = render(<PersonaRailView workspaces={[]} activeId="public" onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
