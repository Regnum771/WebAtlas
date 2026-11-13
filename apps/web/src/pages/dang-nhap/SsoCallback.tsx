import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../../entities/session/model/session.store';
import { Spinner } from '../../shared/ui/Spinner';
import { Message } from '../../shared/ui/Message';

const ERRORS: Record<string, string> = {
  access_denied: 'Đăng nhập đã bị huỷ.',
  inactive: 'Tài khoản này đã bị khoá trên WebATLAS.',
  state: 'Phiên đăng nhập đã hết hạn. Vui lòng thử lại.',
  email: 'Tài khoản đăng nhập một lần chưa có thư điện tử đã xác minh trùng với tài khoản WebATLAS.',
  conflict: 'Thư điện tử này đã gắn với một tài khoản đăng nhập một lần khác. Liên hệ quản trị viên.',
  unavailable: 'Máy chủ đăng nhập một lần không phản hồi. Có thể dùng tài khoản WebATLAS.',
};

/** Only an in-app path: a full URL here would let a crafted link send the user elsewhere. */
export function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

/** /dang-nhap/xong: where the API's SSO callback lands, with the token in the URL fragment. */
export default function SsoCallbackRoute() {
  const { completeSso } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    // The fragment never reaches a server, but it stays in history: drop it at once.
    window.history.replaceState(null, '', window.location.pathname);
    const failure = params.get('error');
    const token = params.get('token');
    if (failure || !token) {
      setError(ERRORS[failure ?? ''] ?? 'Không đăng nhập được. Vui lòng thử lại.');
      return;
    }
    completeSso(token, params.get('id_token'))
      .then(() => navigate(safeReturnTo(params.get('returnTo')), { replace: true }))
      .catch(() => setError('Không đăng nhập được. Vui lòng thử lại.'));
  }, [completeSso, navigate]);

  return (
    // .quan-ly-route places the page over the map; the card draws its own ground.
    <div className="quan-ly-route bg-surface-2 p-0">
      <section
        data-slot="sso-return"
        aria-labelledby="sso-return-title"
        className="mx-auto mt-16 flex w-[min(420px,calc(100%-32px))] flex-col gap-3 rounded-lg border border-line bg-surface p-5 text-body text-ink"
      >
        <h1 id="sso-return-title" className="text-panel font-semibold">Đăng nhập một lần</h1>
        {error ? (
          <>
            <Message tone="error" title={error} />
            <p><Link className="text-water hover:underline" to="/">Về trang chủ</Link></p>
          </>
        ) : (
          <Spinner label="Đang đăng nhập…" />
        )}
      </section>
    </div>
  );
}
