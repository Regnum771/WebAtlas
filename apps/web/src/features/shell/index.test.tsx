import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let workspaces: { id: string; label: string }[] = [];
let activeId = 'public';
vi.mock('./model/useShellPresenter', () => ({
  useShellPresenter: () => ({ workspaces, activeId, isOpen: true, select: vi.fn(), close: vi.fn() }),
}));
// Stub the hosted features so we assert ROUTING, not their internals.
vi.mock('../feature-editing', () => ({ default: () => <div>FEATURE_EDITING</div> }));
vi.mock('../user-management', () => ({ default: () => <div>USER_MANAGEMENT</div> }));

import Shell from './index';

beforeEach(() => { workspaces = []; activeId = 'public'; });

describe('Shell container', () => {
  it('anonymous/public renders no rail and no panel content', () => {
    const { container } = render(<Shell />);
    expect(container.textContent).not.toContain('FEATURE_EDITING');
    expect(container.textContent).not.toContain('USER_MANAGEMENT');
  });

  it('steward workspace hosts FeatureEditing', () => {
    workspaces = [{ id: 'steward', label: 'Data Steward' }]; activeId = 'steward';
    render(<Shell />);
    expect(screen.getByText('FEATURE_EDITING')).toBeInTheDocument();
  });

  it('admin workspace hosts UserManagement', () => {
    workspaces = [{ id: 'steward', label: 'Data Steward' }, { id: 'admin', label: 'Management' }]; activeId = 'admin';
    render(<Shell />);
    expect(screen.getByText('USER_MANAGEMENT')).toBeInTheDocument();
  });

  it('governance workspace hosts the placeholder', () => {
    workspaces = [{ id: 'governance', label: 'Governance' }, { id: 'research', label: 'Research' }]; activeId = 'governance';
    render(<Shell />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
