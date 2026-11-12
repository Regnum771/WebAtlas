import { useGroupsPresenter } from './model/useGroupsPresenter';
import { GroupListView } from './ui/GroupList.view';
import { GroupFormView } from './ui/GroupForm.view';
import { UnitPicker } from './ui/UnitPicker';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';

export { UnitPicker } from './ui/UnitPicker';

const LEVEL_HINT = {
  country: 'Cấp Bộ: chọn Việt Nam.',
  province: 'Cấp tỉnh: chọn các tỉnh.',
  ward: 'Cấp xã: mở tỉnh để chọn các xã.',
} as const;

export function AccessGroupsPanel() {
  const p = useGroupsPresenter();
  return (
    <div className="user-mgmt-panel">
      <GroupListView
        groups={p.groups} tree={p.tree} loading={p.loading} listError={p.listError}
        onRetry={p.retry} onNew={p.openCreate} onEdit={p.openEdit} onDelete={p.askDelete}
      />
      <GroupFormView
        open={p.modal.mode !== 'closed'} mode={p.modal.mode === 'edit' ? 'edit' : 'create'}
        values={p.values} template={p.template} fieldErrors={p.fieldErrors} formError={p.formError}
        canSave={p.canSave} saving={p.saving}
        picker={
          <UnitPicker tree={p.tree} selected={p.values.units} onChange={p.setUnits}
            error={p.fieldErrors.units} hint={p.pickerLevel ? LEVEL_HINT[p.pickerLevel] : null} />
        }
        onTemplate={p.chooseTemplate} onField={p.setField} onTogglePermission={p.togglePermission}
        onSubmit={p.submit} onClose={p.closeModal}
      />
      <ConfirmDialog
        open={p.pendingDelete !== null}
        title="Xoá nhóm"
        message={p.deleteError ? `${p.deleteMessage} ${p.deleteError}` : p.deleteMessage}
        confirmLabel="Xoá" irreversible busy={p.deleting}
        onConfirm={p.confirmDelete} onCancel={p.cancelDelete}
      />
    </div>
  );
}
