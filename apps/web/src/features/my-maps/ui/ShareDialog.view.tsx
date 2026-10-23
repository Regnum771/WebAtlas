import { Button } from '../../../shared/ui/Button';
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog';
import { Dialog } from '../../../shared/ui/Dialog';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import { TextField } from '../../../shared/ui/TextField';
import type { Share, ShareTargets } from '../api/workspace.api';

export interface ShareDialogViewProps {
  query: string;
  /** Null until a search of 2 or more characters has answered. */
  results: ShareTargets | null;
  searching: boolean;
  searchError: string | null;
  /** Null while the list loads. */
  shares: Share[] | null;
  loadError: string | null;
  error: string | null;
  busy: boolean;
  pendingRevoke: { id: string; name: string } | null;
  revoking: boolean;
  onQuery: (q: string) => void;
  onShare: (target: { userId: string } | { groupId: string }) => void;
  onAskRevoke: (share: Share) => void;
  onConfirmRevoke: () => void;
  onCancelRevoke: () => void;
  onClose: () => void;
}

/** Passive: the Chia sẻ bản đồ dialog — search, current shares, and the revoke confirmation. */
export function ShareDialogView(p: ShareDialogViewProps) {
  const users = p.results?.users ?? [];
  const groups = p.results?.groups ?? [];
  return (
    <>
      <Dialog open title="Chia sẻ bản đồ" onClose={p.onClose}>
        <div className="form-stack">
          <TextField
            id="share-search"
            label="Tìm người dùng hoặc nhóm"
            hint="Gõ ít nhất 2 ký tự."
            value={p.query}
            autoComplete="off"
            onChange={(e) => p.onQuery(e.target.value)}
          />
          {p.searching && <Spinner />}
          {p.searchError && <Message tone="error" title={p.searchError} />}
          {users.length > 0 && (
            <section aria-labelledby="share-users-title">
              <h3 id="share-users-title" className="layers-group-title">Người dùng</h3>
              <ul className="share-rows">
                {users.map((u) => (
                  <li key={u.id} className="share-row">
                    <span>{u.name} <span className="hint">{u.email}</span></span>
                    <Button size="sm" disabled={p.busy} onClick={() => p.onShare({ userId: u.id })}>Chia sẻ</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {groups.length > 0 && (
            <section aria-labelledby="share-groups-title">
              <h3 id="share-groups-title" className="layers-group-title">Nhóm</h3>
              <ul className="share-rows">
                {groups.map((g) => (
                  <li key={g.id} className="share-row">
                    <span>{g.name}</span>
                    <Button size="sm" disabled={p.busy} onClick={() => p.onShare({ groupId: g.id })}>Chia sẻ</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="share-current-title">
            <h3 id="share-current-title" className="layers-group-title">Đang chia sẻ với</h3>
            {p.loadError && <Message tone="error" title={p.loadError} />}
            {p.shares === null ? (p.loadError ? null : <Spinner />) : p.shares.length === 0 ? (
              <p className="my-maps-empty">Chưa chia sẻ với ai.</p>
            ) : (
              <ul className="share-rows">
                {p.shares.map((s) => (
                  <li key={s.id} className="share-row">
                    <span>{s.name}</span>
                    <Button size="sm" variant="danger" onClick={() => p.onAskRevoke(s)}>Thu hồi</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {p.error && <Message tone="error" title={p.error} />}
          <div className="dialog-actions">
            <Button onClick={p.onClose}>Đóng</Button>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={p.pendingRevoke !== null}
        title={`Thu hồi chia sẻ với ${p.pendingRevoke?.name ?? ''}?`}
        message="Người này sẽ không còn xem được bản đồ. Bản sao họ đã tạo vẫn là của họ."
        confirmLabel="Thu hồi"
        irreversible
        busy={p.revoking}
        onConfirm={p.onConfirmRevoke}
        onCancel={p.onCancelRevoke}
      />
    </>
  );
}
