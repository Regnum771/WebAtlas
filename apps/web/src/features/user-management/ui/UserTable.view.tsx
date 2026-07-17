import type { AdminUser } from '../api/users.api';

export function UserTableView({ users, canModify, onEdit, onToggleActive, onNew, loading, listError }: {
  users: AdminUser[];
  canModify: (u: AdminUser) => boolean;
  onEdit: (u: AdminUser) => void;
  onToggleActive: (u: AdminUser) => void;
  onNew: () => void;
  loading: boolean;
  listError: string | null;
}) {
  return (
    <div className="user-mgmt">
      <div className="user-mgmt-header">
        <h2>Users</h2>
        <button type="button" className="user-new-btn" onClick={onNew}>New user</button>
      </div>
      {listError && <p className="user-mgmt-error" role="alert">{listError}</p>}
      {loading ? (
        <p>Loading users…</p>
      ) : (
        <table className="user-table">
          <thead>
            <tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const locked = !canModify(u);
              const title = locked ? "You can't change your own access" : undefined;
              return (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.full_name ?? '—'}</td>
                  <td>{u.role}</td>
                  <td>
                    <span className={`badge ${u.is_active ? 'badge-active' : 'badge-inactive'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <button type="button" onClick={() => onEdit(u)} disabled={locked} title={title}>Edit</button>
                    <button type="button" onClick={() => onToggleActive(u)} disabled={locked} title={title}>
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
