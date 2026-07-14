import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RequireRole } from './RequireRole';

function mockSession(user: { role: string } | null) {
  vi.doMock('../../../entities/session/model/session.store', () => ({
    useSession: () => ({ currentUser: user, status: user ? 'authenticated' : 'anonymous', login: vi.fn(), logout: vi.fn() }),
  }));
}

describe('RequireRole (UX gate)', () => {
  it('renders children for a matching role', async () => {
    vi.resetModules();
    mockSession({ role: 'admin' });
    const { RequireRole: Fresh } = await import('./RequireRole');
    render(<Fresh role="admin"><div>secret</div></Fresh>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('renders the fallback for a non-matching role', async () => {
    vi.resetModules();
    mockSession({ role: 'viewer' });
    const { RequireRole: Fresh } = await import('./RequireRole');
    render(<Fresh role="admin" fallback={<div>denied</div>}><div>secret</div></Fresh>);
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('renders nothing for anonymous with no fallback', async () => {
    vi.resetModules();
    mockSession(null);
    const { RequireRole: Fresh } = await import('./RequireRole');
    const { container } = render(<Fresh role="admin"><div>secret</div></Fresh>);
    expect(container).toBeEmptyDOMElement();
  });
});
// keep the top-level import referenced so the file type-checks
void RequireRole;
