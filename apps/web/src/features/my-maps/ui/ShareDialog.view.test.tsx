import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareDialogView, type ShareDialogViewProps } from './ShareDialog.view';

const LAN = { id: 's1', userId: 'u2', groupId: null, name: 'Lan', createdAt: '' };
const base = (over: Partial<ShareDialogViewProps> = {}): ShareDialogViewProps => ({
  query: '', results: null, searching: false, searchError: null, shares: [], loadError: null, error: null, busy: false,
  pendingRevoke: null, revoking: false,
  onQuery: vi.fn(), onShare: vi.fn(), onAskRevoke: vi.fn(), onConfirmRevoke: vi.fn(), onCancelRevoke: vi.fn(), onClose: vi.fn(),
  ...over,
});

describe('ShareDialogView', () => {
  it('has the title, the search with its hint and the empty list', () => {
    render(<ShareDialogView {...base()} />);
    expect(screen.getByRole('dialog', { name: 'Chia sẻ bản đồ' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tìm người dùng hoặc nhóm')).toBeInTheDocument();
    expect(screen.getByText('Gõ ít nhất 2 ký tự.')).toBeInTheDocument();
    expect(screen.getByText('Đang chia sẻ với')).toBeInTheDocument();
    expect(screen.getByText('Chưa chia sẻ với ai.')).toBeInTheDocument();
  });

  it('lists users with their email and groups, each with Chia sẻ', async () => {
    const onShare = vi.fn();
    render(<ShareDialogView {...base({
      query: 'la', onShare,
      results: { users: [{ id: 'u2', name: 'Lan', email: 'lan@x.vn' }], groups: [{ id: 'g1', name: 'Phòng QLĐT' }] },
    })} />);
    expect(screen.getByRole('heading', { name: 'Người dùng' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nhóm' })).toBeInTheDocument();
    expect(screen.getByText('lan@x.vn')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Chia sẻ' });
    expect(buttons).toHaveLength(2);
    await userEvent.setup().click(buttons[0]);
    expect(onShare).toHaveBeenCalledWith({ userId: 'u2' });
    await userEvent.setup().click(buttons[1]);
    expect(onShare).toHaveBeenLastCalledWith({ groupId: 'g1' });
  });

  it('lists the current shares with Thu hồi', async () => {
    const onAskRevoke = vi.fn();
    render(<ShareDialogView {...base({ shares: [LAN], onAskRevoke })} />);
    expect(screen.queryByText('Chưa chia sẻ với ai.')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thu hồi' }));
    expect(onAskRevoke).toHaveBeenCalledWith(LAN);
  });

  it('the revoke confirmation names the person and explains', () => {
    render(<ShareDialogView {...base({ shares: [LAN], pendingRevoke: { id: 's1', name: 'Lan' } })} />);
    const confirm = screen.getByRole('dialog', { name: 'Thu hồi chia sẻ với Lan?' });
    expect(within(confirm).getByText('Người này sẽ không còn xem được bản đồ. Bản sao họ đã tạo vẫn là của họ.')).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Thu hồi' })).toBeInTheDocument();
  });
});
