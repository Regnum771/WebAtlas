import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
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

const PANEL = 'flex flex-col gap-3 rounded-lg border border-line bg-surface p-4';

/** Passive: who is signed in and what they may do (a page title, then two panels). */
export function ProfileView({ name, email, roleLabel, signInMethod, isAdmin, scope, accountUrl }: ProfileViewProps) {
  return (
    <div data-slot="profile" className="mx-auto flex max-w-[960px] flex-col gap-4 px-6 py-8 text-body text-ink">
      <h1 className="text-page font-semibold">Hồ sơ</h1>
      <section aria-labelledby="profile-account" className={PANEL}>
        <h2 id="profile-account" className="text-panel font-semibold">Tài khoản</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
          <dt className="text-ink-2">Họ tên</dt><dd>{name ?? '—'}</dd>
          <dt className="text-ink-2">Thư điện tử</dt><dd className="[overflow-wrap:anywhere]">{email}</dd>
          <dt className="text-ink-2">Vai trò</dt><dd>{roleLabel}</dd>
          <dt className="text-ink-2">Đăng nhập bằng</dt><dd>{signInMethod === 'sso' ? 'Đăng nhập một lần' : 'Tài khoản WebATLAS'}</dd>
        </dl>
        {accountUrl && signInMethod === 'sso' && (
          <a className="inline-flex items-center gap-1 self-start text-water hover:underline" href={accountUrl} target="_blank" rel="noopener noreferrer">
            Đổi mật khẩu, xem phiên đăng nhập
            <ArrowUpRight size={14} aria-label="(mở thẻ mới)" />
          </a>
        )}
      </section>
      <section aria-labelledby="profile-scope" className={PANEL}>
        <h2 id="profile-scope" className="text-panel font-semibold">Phạm vi quyền</h2>
        {isAdmin ? (
          <p>Quản trị viên: mọi quyền trên mọi đơn vị.</p>
        ) : scope.length === 0 ? (
          <p className="text-ink-2">Chỉ xem. Chưa thuộc nhóm quyền nào; người quản lý người dùng có thể thêm anh/chị vào nhóm.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead className="bg-surface-2 text-left text-label text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Đơn vị</th>
                <th scope="col" className="px-3 py-2 font-semibold">Quyền</th>
              </tr>
            </thead>
            <tbody>
              {scope.map((row) => (
                <tr key={row.unit} className="border-t border-line-3">
                  <td className="px-3 py-2 align-top">{row.unitName}</td>
                  <td className="px-3 py-2 align-top text-ink-2">{row.permissions.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <Link className="self-start text-water hover:underline" to="/ban-do">Bản của tôi trên bản đồ</Link>
    </div>
  );
}
