import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let mock: { status: string; currentUser: unknown };
vi.mock('../../../entities/session/model/session.store', () => ({
  useSession: () => mock,
}));

import { RequireRole } from './RequireRole';

describe('RequireRole', () => {
  it('renders children for an allowed role', () => {
    mock = { status: 'authenticated', currentUser: { role: 'admin' } };
    render(<RequireRole role="admin"><div>SECRET</div></RequireRole>);
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });

  it('renders the fallback for a disallowed role', () => {
    mock = { status: 'authenticated', currentUser: { role: 'viewer' } };
    render(<RequireRole role="admin" fallback={<div>NOPE</div>}><div>SECRET</div></RequireRole>);
    expect(screen.getByText('NOPE')).toBeInTheDocument();
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
  });

  it('renders the fallback for an anonymous visitor (resolved, no user)', () => {
    mock = { status: 'anonymous', currentUser: null };
    render(<RequireRole role="admin" fallback={<div>NOPE</div>}><div>SECRET</div></RequireRole>);
    expect(screen.getByText('NOPE')).toBeInTheDocument();
  });

  it('renders nothing for anonymous with no fallback', () => {
    mock = { status: 'anonymous', currentUser: null };
    const { container } = render(<RequireRole role="admin"><div>SECRET</div></RequireRole>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders children when the role is in the allowed array', () => {
    mock = { status: 'authenticated', currentUser: { role: 'editor' } };
    render(<RequireRole role={['admin', 'editor']}><div>SECRET</div></RequireRole>);
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });

  it('does NOT redirect while the session is still authenticating (renders neither yet)', () => {
    mock = { status: 'authenticating', currentUser: null };
    const { container } = render(
      <RequireRole role="admin" fallback={<div>NOPE</div>}><div>SECRET</div></RequireRole>
    );
    // The whole point: a stored-token admin on cold load must not be bounced to
    // the fallback before rehydration resolves.
    expect(screen.queryByText('NOPE')).not.toBeInTheDocument();
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
