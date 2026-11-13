import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProfileView, type ProfileViewProps } from './Profile.view';

const base: ProfileViewProps = {
  name: 'Nguyễn Văn An', email: 'an@example.vn', roleLabel: 'Người xem', signInMethod: 'local', isAdmin: false,
  scope: [], accountUrl: 'http://localhost:8180/realms/webatlas/account',
};
const ui = (props: Partial<ProfileViewProps> = {}) => <MemoryRouter><ProfileView {...base} {...props} /></MemoryRouter>;

describe('ProfileView', () => {
  it('is a converted page with a title and an account panel of facts', () => {
    const { container } = render(ui());
    expect(container.querySelector('[data-slot="profile"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Hồ sơ' })).toBeInTheDocument();
    const account = screen.getByRole('region', { name: 'Tài khoản' });
    expect(within(account).getByText('Nguyễn Văn An')).toBeInTheDocument();
    expect(within(account).getByText('Tài khoản WebATLAS')).toBeInTheDocument();
  });

  it('shows a dash for a missing name', () => {
    render(ui({ name: null }));
    expect(within(screen.getByRole('region', { name: 'Tài khoản' })).getByText('—')).toBeInTheDocument();
  });

  it('links to the account console only after single sign-on', () => {
    const { unmount } = render(ui());
    expect(screen.queryByRole('link', { name: /Đổi mật khẩu/ })).toBeNull();
    unmount();
    render(ui({ signInMethod: 'sso' }));
    const link = screen.getByRole('link', { name: /Đổi mật khẩu, xem phiên đăng nhập/ });
    expect(link).toHaveAttribute('href', base.accountUrl);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('describes the scope: admin, none, or a table of units and permissions', () => {
    const scopePanel = () => screen.getByRole('region', { name: 'Phạm vi quyền' });
    const first = render(ui({ isAdmin: true }));
    expect(scopePanel()).toHaveTextContent('Quản trị viên: mọi quyền trên mọi đơn vị.');
    first.unmount();
    const second = render(ui());
    expect(scopePanel()).toHaveTextContent('Chỉ xem.');
    second.unmount();
    render(ui({ scope: [{ unit: '48', unitName: 'Đà Nẵng', permissions: ['Sửa đối tượng', 'Duyệt'] }] as ProfileViewProps['scope'] }));
    const rows = within(scopePanel()).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Đà NẵngSửa đối tượng, Duyệt');
  });
});
