import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const G = { id: 'g1', name: 'Tổ Đà Nẵng', description: null, units: ['48'], permissions: [], memberCount: 3 };
const askDelete = vi.fn();
let pending: typeof G | null = null;
vi.mock('./model/useGroupsPresenter', () => ({
  useGroupsPresenter: () => ({
    groups: [G], tree: null, loading: false, listError: null, retry: vi.fn(),
    modal: { mode: 'closed' }, values: { name: '', description: '', units: [], permissions: [] },
    template: null, pickerLevel: null, fieldErrors: {}, formError: null, canSave: false, saving: false,
    openCreate: vi.fn(), openEdit: vi.fn(), closeModal: vi.fn(), chooseTemplate: vi.fn(), setField: vi.fn(),
    setUnits: vi.fn(), togglePermission: vi.fn(), submit: vi.fn(),
    pendingDelete: pending, deleteError: null, deleting: false,
    deleteMessage: pending ? 'Xoá nhóm Tổ Đà Nẵng? 3 người sẽ mất các quyền của nhóm này.' : '',
    askDelete, cancelDelete: vi.fn(), confirmDelete: vi.fn(),
  }),
}));

import { AccessGroupsPanel } from './index';

describe('AccessGroupsPanel', () => {
  it('delete asks with the member count', async () => {
    pending = G;
    render(<AccessGroupsPanel />);
    expect(screen.getByText('Xoá nhóm Tổ Đà Nẵng? 3 người sẽ mất các quyền của nhóm này.')).toBeInTheDocument();
    pending = null;
  });

  it('the Xoá button on a row asks the presenter', async () => {
    pending = null;
    render(<AccessGroupsPanel />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Xoá' }));
    expect(askDelete).toHaveBeenCalledWith(G);
  });
});
