import { useUsersPresenter } from './model/useUsersPresenter';
import { UserTableView } from './ui/UserTable.view';
import { UserFormModalView } from './ui/UserFormModal.view';
import { Button } from '../../shared/ui/Button';

// The `open` prop is gone: a route's existence IS the open signal (design §4.4).
// The panel no longer renders its own Close button — the route owns dismissal,
// which also removes the duplicate close chrome found during /run.
export function UserManagementPanel({ onClose }: { onClose: () => void }) {
  const p = useUsersPresenter();
  return (
    <div className="user-mgmt-panel">
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
      <div className="user-mgmt-footer">
        <Button onClick={onClose}>Về bản đồ</Button>
      </div>
    </div>
  );
}
