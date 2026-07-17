import { RequireRole } from '../auth/ui/RequireRole';
import { useUsersPresenter } from './model/useUsersPresenter';
import { UserTableView } from './ui/UserTable.view';
import { UserFormModalView } from './ui/UserFormModal.view';

function Panel({ onClose }: { onClose: () => void }) {
  const p = useUsersPresenter();
  return (
    <div className="user-mgmt-panel glass-panel">
      <button type="button" className="user-mgmt-close" onClick={onClose}>Close</button>
      <UserTableView
        users={p.users} canModify={p.canModify}
        onEdit={p.openEdit} onToggleActive={p.toggleActive} onNew={p.openCreate}
        loading={p.loading} listError={p.listError}
      />
      <UserFormModalView
        open={p.modal.mode !== 'closed'}
        mode={p.modal.mode === 'edit' ? 'edit' : 'create'}
        values={p.values} fieldErrors={p.fieldErrors} formError={p.formError}
        canSave={p.canSave} saving={p.saving}
        onField={p.setField} onSubmit={p.submitForm} onClose={p.closeModal}
      />
    </div>
  );
}

// UX gate ONLY. Real authorization is enforced by the backend (admin on every
// /api/users route); a non-admin who forces this open still gets 401/403.
export default function UserManagement({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <RequireRole role="admin">
      <Panel onClose={onClose} />
    </RequireRole>
  );
}
