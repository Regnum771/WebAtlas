import { useDisplayPanelPresenter } from './model/useDisplayPanelPresenter';
import { DisplayPanelView } from './ui/DisplayPanel.view';
import { useEditExistingPresenter } from '../../features/feature-editing/model/useEditExistingPresenter';
import { useAttributeFormPresenter } from '../../features/feature-editing/model/useAttributeFormPresenter';
import { AttributeFormView } from '../../features/feature-editing/ui/AttributeForm.view';

// Drives AttributeFormView through useAttributeFormPresenter exactly like
// features/feature-editing/index.tsx's EditForm — the form component has its own
// passing tests and must be conformed to, not re-shaped.
function EditForm({
  sel, workingGeometry, onSaved, onCancel,
}: {
  sel: NonNullable<ReturnType<typeof useEditExistingPresenter>['selection']>;
  workingGeometry: ReturnType<typeof useEditExistingPresenter>['workingGeometry'];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const form = useAttributeFormPresenter({
    layerKey: sel.layerKey, attributes: sel.attributes, geometry: workingGeometry,
    mode: 'edit', featureId: sel.featureId, initialValues: sel.initialValues, onSaved,
  });
  return (
    <AttributeFormView
      attributes={sel.attributes} labels={form.labels} values={form.values}
      fieldErrors={form.fieldErrors} error={form.error} canSave={form.canSave}
      saving={form.saving} onField={form.setField} onSubmit={form.submit} onCancel={onCancel}
    />
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
        <EditForm
          // key remounts EditForm per selection so the form re-seeds initialValues
          // (useAttributeFormPresenter's useState initializer runs once).
          key={edit.selection.featureId}
          sel={edit.selection}
          workingGeometry={edit.workingGeometry}
          onSaved={edit.onSaved}
          onCancel={edit.cancelEdit}
        />
      ) : undefined}
    </DisplayPanelView>
  );
}
