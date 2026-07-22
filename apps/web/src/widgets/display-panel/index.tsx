import { useDisplayPanelPresenter } from './model/useDisplayPanelPresenter';
import { DisplayPanelView } from './ui/DisplayPanel.view';
import { useEditExistingPresenter } from '../../features/feature-editing/model/useEditExistingPresenter';
import { useAttributeFormPresenter } from '../../features/feature-editing/model/useAttributeFormPresenter';
import { AttributeFormView } from '../../features/feature-editing/ui/AttributeForm.view';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';

// Drives AttributeFormView through useAttributeFormPresenter exactly like
// features/feature-editing/index.tsx's EditForm — the form component has its own
// passing tests and must be conformed to, not re-shaped.
//
// Delete lives here too, alongside the form, gated behind the same pen-pressed edit
// mode: the pen is the deliberate gate for mutation, and delete is more destructive
// than a geometry nudge, so it must not be easier to reach than the form is.
function EditForm({
  sel, workingGeometry, onSaved, onCancel, onDelete,
}: {
  sel: NonNullable<ReturnType<typeof useEditExistingPresenter>['selection']>;
  workingGeometry: ReturnType<typeof useEditExistingPresenter>['workingGeometry'];
  onSaved: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const form = useAttributeFormPresenter({
    layerKey: sel.layerKey, attributes: sel.attributes, geometry: workingGeometry,
    mode: 'edit', featureId: sel.featureId, initialValues: sel.initialValues, onSaved,
  });
  return (
    <>
      <AttributeFormView
        attributes={sel.attributes} labels={form.labels} values={form.values}
        fieldErrors={form.fieldErrors} error={form.error} canSave={form.canSave}
        saving={form.saving} onField={form.setField} onSubmit={form.submit} onCancel={onCancel}
      />
      <button type="button" className="edit-delete-btn" onClick={onDelete}>Xóa đối tượng</button>
    </>
  );
}

export default function DisplayPanel() {
  const s = useDisplayPanelPresenter();
  const edit = useEditExistingPresenter();
  if (!s.visible) return null;

  return (
    <DisplayPanelView
      title={s.title}
      layerLabel={s.layerLabel}
      rows={s.rows}
      collapsed={s.collapsed}
      canEdit={s.canEdit}
      onToggleCollapse={s.toggleCollapse}
      onEdit={edit.beginEdit}
      onClose={s.close}
    >
      {edit.editing && edit.selection ? (
        <>
          <EditForm
            // key remounts EditForm per selection so the form re-seeds initialValues
            // (useAttributeFormPresenter's useState initializer runs once).
            key={edit.selection.featureId}
            sel={edit.selection}
            workingGeometry={edit.workingGeometry}
            onSaved={edit.onSaved}
            onCancel={edit.cancelEdit}
            onDelete={edit.requestDelete}
          />
          {edit.error && <p className="edit-form-error" role="alert">{edit.error}</p>}
          <ConfirmDialog
            open={edit.confirmOpen}
            title="Xóa đối tượng"
            message="Xóa đối tượng này? Hành động không thể hoàn tác."
            confirmLabel="Xóa"
            busy={edit.deleting}
            onConfirm={edit.confirmDelete}
            onCancel={edit.cancelDelete}
          />
        </>
      ) : undefined}
    </DisplayPanelView>
  );
}
