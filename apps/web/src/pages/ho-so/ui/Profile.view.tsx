import { Link } from 'react-router-dom';
import type { ScopeRow } from '../model/profile';

export interface ProfileViewProps {
  name: string | null;
  email: string;
  roleLabel: string;
  /** 'sso': signed in through the platform's single sign-on; 'local': a WebAtlas password. */
  signInMethod: 'sso' | 'local';
  isAdmin: boolean;
  scope: ScopeRow[];
  /** Keycloak's account console (password, sessions); null when single sign-on is not set up. */
  accountUrl: string | null;
}

/** Passive: who is signed in and what they may do. */
export function ProfileView({ name, email, roleLabel, signInMethod, isAdmin, scope, accountUrl }: ProfileViewProps) {
  return (
    <div className="quan-ly-section profile">
      <h2>Hồ sơ</h2>
      <dl className="profile-facts">
        <dt>Họ tên</dt><dd>{name ?? '—'}</dd>
        <dt>Thư điện tử</dt><dd>{email}</dd>
        <dt>Vai trò</dt><dd>{roleLabel}</dd>
        <dt>Đăng nhập bằng</dt><dd>{signInMethod === 'sso' ? 'Đăng nhập một lần' : 'Tài khoản WebATLAS'}</dd>
      </dl>
      {accountUrl && signInMethod === 'sso' && (
        <p>
          <a className="link" href={accountUrl} target="_blank" rel="noopener noreferrer">
            Đổi mật khẩu, xem phiên đăng nhập
          </a>
        </p>
      )}
      <section aria-label="Phạm vi quyền" className="profile-scope">
        <h3>Phạm vi quyền</h3>
        {isAdmin ? (
          <p>Quản trị viên: mọi quyền trên mọi đơn vị.</p>
        ) : scope.length === 0 ? (
          <p>Chỉ xem. Chưa thuộc nhóm quyền nào; người quản lý người dùng có thể thêm anh/chị vào nhóm.</p>
        ) : (
          <table className="user-table">
            <thead><tr><th scope="col">Đơn vị</th><th scope="col">Quyền</th></tr></thead>
            <tbody>
              {scope.map((row) => (
                <tr key={row.unit}><td>{row.unitName}</td><td>{row.permissions.join(', ')}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p><Link className="link" to="/ban-do">Bản của tôi trên bản đồ</Link></p>
    </div>
  );
}
