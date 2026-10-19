import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildUnitTree } from '@webatlas/shared';
import { UserGroupsDialogView } from './UserGroupsDialog.view';
import type { AccessGroup } from '../../access-groups/api/accessGroups.api';

const tree = buildUnitTree([
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
]);
const groups: AccessGroup[] = [
  { id: 'g1', name: 'Trong phạm vi', description: null, units: ['48'], permissions: ['feature.update'], memberCount: 1 },
  { id: 'g2', name: 'Ngoài phạm vi', description: null, units: ['VN'], permissions: ['users.manage'], memberCount: 0 },
];

const base = {
  open: true, userLabel: 'ed@b.test', groups, tree, selected: ['g1'], saving: false, error: null,
  canHandOver: (g: AccessGroup) => g.id === 'g1',
  onToggle: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn(),
};

describe('UserGroupsDialogView', () => {
  it('a users.manage holder cannot tick an out-of-scope group', async () => {
    const onToggle = vi.fn();
    render(<UserGroupsDialogView {...base} onToggle={onToggle} />);
    const out = screen.getByRole('checkbox', { name: /Ngoài phạm vi/ });
    expect(out).toBeDisabled();
    expect(out.closest('label')).toHaveAttribute('title', 'Ngoài phạm vi quản lý của anh/chị');
    expect(screen.getAllByText('Ngoài phạm vi quản lý của anh/chị')).toHaveLength(1);
    await userEvent.click(out);
    expect(onToggle).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Trong phạm vi/ }));
    expect(onToggle).toHaveBeenCalledWith('g1');
  });

  it('a 403 ESCALATION shows the server message in the dialog', () => {
    render(<UserGroupsDialogView {...base} error="Nhóm vượt quá quyền của anh/chị." />);
    expect(screen.getByText('Nhóm vượt quá quyền của anh/chị.')).toBeInTheDocument();
  });

  it('shows an empty state when there are no groups', () => {
    render(<UserGroupsDialogView {...base} groups={[]} />);
    expect(screen.getByText('Chưa có nhóm nào.')).toBeInTheDocument();
  });

  it('saves and closes via the buttons', async () => {
    const onSubmit = vi.fn(); const onClose = vi.fn();
    render(<UserGroupsDialogView {...base} onSubmit={onSubmit} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(onSubmit).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onClose).toHaveBeenCalled();
  });
});
