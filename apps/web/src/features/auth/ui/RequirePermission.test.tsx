import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Grant } from '@webatlas/shared';

let mock: { status: string; currentUser: { isAdmin: boolean; grants: Grant[] } | null };
vi.mock('../../../entities/session/model/session.store', () => ({ useSession: () => mock }));
vi.mock('../../../entities/session/model/useUnitTree', () => ({ useUnitTree: () => null }));

import { RequirePermission } from './RequirePermission';

const officer = (...permissions: Grant['permission'][]) => ({
  status: 'authenticated',
  currentUser: { isAdmin: false, grants: permissions.map((permission) => ({ permission, unit: '48' })) },
});
const both: Grant['permission'][] = ['feature.update', 'submission.review'];

describe('RequirePermission', () => {
  it('mode all needs both permissions', () => {
    mock = officer('feature.update');
    const { unmount } = render(
      <RequirePermission permission={both} mode="all" fallback={<div>NOPE</div>}><div>SECRET</div></RequirePermission>,
    );
    expect(screen.getByText('NOPE')).toBeInTheDocument();
    unmount();
    mock = officer('feature.update', 'submission.review');
    render(<RequirePermission permission={both} mode="all"><div>SECRET</div></RequirePermission>);
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });

  it('mode any (default) needs one', () => {
    mock = officer('submission.review');
    render(<RequirePermission permission={both}><div>SECRET</div></RequirePermission>);
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });

  it('lets an admin through', () => {
    mock = { status: 'authenticated', currentUser: { isAdmin: true, grants: [] } };
    render(<RequirePermission permission="users.manage"><div>SECRET</div></RequirePermission>);
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });

  it('shows the fallback to a visitor and nothing while authenticating', () => {
    mock = { status: 'anonymous', currentUser: null };
    const { unmount } = render(
      <RequirePermission permission="feature.update" fallback={<div>NOPE</div>}><div>SECRET</div></RequirePermission>,
    );
    expect(screen.getByText('NOPE')).toBeInTheDocument();
    unmount();
    mock = { status: 'authenticating', currentUser: null };
    const { container } = render(
      <RequirePermission permission="feature.update" fallback={<div>NOPE</div>}><div>SECRET</div></RequirePermission>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
