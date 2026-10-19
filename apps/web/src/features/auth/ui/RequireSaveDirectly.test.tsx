import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Grant } from '@webatlas/shared';

let mock: { status: string; currentUser: { isAdmin: boolean; grants: Grant[] } | null };
vi.mock('../../../entities/session/model/session.store', () => ({ useSession: () => mock }));
vi.mock('../../../entities/session/model/useUnitTree', async () => {
  const shared = await import('@webatlas/shared');
  const tree = shared.buildUnitTree([
    { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
    { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
    { code: '51', level: 'province', parent: 'VN', name: 'Quảng Ngãi' },
  ]);
  return { useUnitTree: () => tree };
});

import { RequireSaveDirectly } from './RequireSaveDirectly';

const officer = (...grants: Grant[]) => ({ status: 'authenticated', currentUser: { isAdmin: false, grants } });
const gate = () => render(<RequireSaveDirectly fallback={<div>NOPE</div>}><div>SECRET</div></RequireSaveDirectly>);

describe('RequireSaveDirectly', () => {
  it('passes update and review on the same unit', () => {
    mock = officer({ permission: 'feature.update', unit: '48' }, { permission: 'submission.review', unit: '48' });
    gate();
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });

  it('refuses update and review on disjoint units', () => {
    mock = officer({ permission: 'feature.update', unit: '48' }, { permission: 'submission.review', unit: '51' });
    gate();
    expect(screen.getByText('NOPE')).toBeInTheDocument();
  });

  it('lets an admin through and keeps a signed-out visitor out', () => {
    mock = { status: 'authenticated', currentUser: { isAdmin: true, grants: [] } };
    const { unmount } = gate();
    expect(screen.getByText('SECRET')).toBeInTheDocument();
    unmount();
    mock = { status: 'anonymous', currentUser: null };
    gate();
    expect(screen.getByText('NOPE')).toBeInTheDocument();
  });

  it('decides nothing while the stored session is resolving', () => {
    mock = { status: 'authenticating', currentUser: null };
    gate();
    expect(screen.queryByText('NOPE')).toBeNull();
    expect(screen.queryByText('SECRET')).toBeNull();
  });
});
