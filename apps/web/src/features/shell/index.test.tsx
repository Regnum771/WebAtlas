import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let canEdit = false;
let isOpen = false;
const toggle = vi.fn(() => { isOpen = !isOpen; });
const close = vi.fn(() => { isOpen = false; });
vi.mock('./model/useShellPresenter', () => ({
  useShellPresenter: () => ({ canEdit, isOpen, toggle, close }),
}));
// Stub the hosted features so we assert ROUTING, not their internals.
vi.mock('../feature-editing', () => ({ default: () => <div>FEATURE_EDITING</div> }));
vi.mock('../attribute-filter', () => ({ default: () => <div>ATTRIBUTE_FILTER</div> }));

import Shell from './index';

beforeEach(() => { canEdit = false; isOpen = false; toggle.mockClear(); close.mockClear(); });

describe('Shell', () => {
  it('renders the burger for every role, closed by default', () => {
    render(<Shell />);
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
    expect(screen.queryByText('FEATURE_EDITING')).not.toBeInTheDocument();
  });

  it('clicking the burger toggles the drawer', async () => {
    render(<Shell />);
    await userEvent.click(screen.getByRole('button', { name: /menu/i }));
    expect(toggle).toHaveBeenCalled();
  });

  it('hosts the filter for every role when open, even without edit rights', () => {
    isOpen = true;
    render(<Shell />);
    expect(screen.getByText('ATTRIBUTE_FILTER')).toBeInTheDocument();
    expect(screen.queryByText('FEATURE_EDITING')).not.toBeInTheDocument();
  });

  it('hosts FeatureEditing when open AND the persona can edit', () => {
    isOpen = true; canEdit = true;
    render(<Shell />);
    expect(screen.getByText('ATTRIBUTE_FILTER')).toBeInTheDocument();
    expect(screen.getByText('FEATURE_EDITING')).toBeInTheDocument();
  });
});
