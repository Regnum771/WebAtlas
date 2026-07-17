import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let hasDrawer = false;
let isOpen = false;
const toggle = vi.fn(() => { isOpen = !isOpen; });
const close = vi.fn(() => { isOpen = false; });
vi.mock('./model/useShellPresenter', () => ({
  useShellPresenter: () => ({ hasDrawer, isOpen, toggle, close }),
}));
// Stub the hosted feature so we assert ROUTING, not its internals.
vi.mock('../feature-editing', () => ({ default: () => <div>FEATURE_EDITING</div> }));

import Shell from './index';

beforeEach(() => { hasDrawer = false; isOpen = false; toggle.mockClear(); close.mockClear(); });

describe('Shell', () => {
  it('renders no burger when the role has no drawer (viewer/anonymous)', () => {
    const { container } = render(<Shell />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the burger when the role has a drawer, closed by default', () => {
    hasDrawer = true;
    render(<Shell />);
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
    expect(screen.queryByText('FEATURE_EDITING')).not.toBeInTheDocument();
  });

  it('clicking the burger toggles the drawer', async () => {
    hasDrawer = true;
    render(<Shell />);
    await userEvent.click(screen.getByRole('button', { name: /menu/i }));
    expect(toggle).toHaveBeenCalled();
  });

  it('hosts FeatureEditing when open', () => {
    hasDrawer = true; isOpen = true;
    render(<Shell />);
    expect(screen.getByText('FEATURE_EDITING')).toBeInTheDocument();
  });
});
