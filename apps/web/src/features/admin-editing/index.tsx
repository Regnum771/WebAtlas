import { LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { RequireRole } from '../auth/ui/RequireRole';
import { useMapEditing, type GeoJSONGeometry } from '../map/model/mapEditing';
import { useEditToolbarPresenter } from './model/useEditToolbarPresenter';
import { useAttributeFormPresenter } from './model/useAttributeFormPresenter';
import { useEditExistingPresenter } from './model/useEditExistingPresenter';
import { EditToolbarView } from './ui/EditToolbar.view';
import { LayerPickerView } from './ui/LayerPicker.view';
import { DrawControlsView } from './ui/DrawControls.view';
import { AttributeFormView } from './ui/AttributeForm.view';
import { EditModeToggleView } from './ui/EditModeToggle.view';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';

function EditToolbar() {
  const toolbar = useEditToolbarPresenter();
  const { refreshLayer } = useMapEditing();
  const selected = toolbar.layers.find((l) => l.key === toolbar.selectedKey) ?? null;

  const form = useAttributeFormPresenter({
    layerKey: (toolbar.selectedKey ?? 'dams') as EditableLayerKey,
    attributes: selected?.attributes ?? [],
    geometry: toolbar.pendingGeometry,
    onSaved: () => {
      if (toolbar.selectedKey) {
        refreshLayer(LAYER_ATTRIBUTE_MAP[toolbar.selectedKey as EditableLayerKey].layerStateId);
      }
      toolbar.cancel();
    },
  });

  return (
    <EditToolbarView>
      <LayerPickerView
        layers={toolbar.layers.map((l) => ({ key: l.key, geomType: l.geomType }))}
        selectedKey={toolbar.selectedKey}
        onSelect={(k) => toolbar.selectLayer(k as EditableLayerKey)}
      />
      <DrawControlsView
        geomType={toolbar.selectableGeomType}
        mode={toolbar.mode}
        onStartDraw={toolbar.startDrawing}
        onCancel={toolbar.cancel}
      />
      {toolbar.mode === 'form' && selected && (
        <AttributeFormView
          attributes={selected.attributes}
          labels={form.labels}
          values={form.values}
          fieldErrors={form.fieldErrors}
          error={form.error}
          canSave={form.canSave}
          saving={form.saving}
          onField={form.setField}
          onSubmit={form.submit}
          onCancel={toolbar.cancel}
        />
      )}
    </EditToolbarView>
  );
}

function EditForm({ sel, workingGeometry, onSaved, onCancel, onDelete }: {
  sel: NonNullable<ReturnType<typeof useEditExistingPresenter>['selection']>;
  workingGeometry: GeoJSONGeometry | null;
  onSaved: () => void; onCancel: () => void; onDelete: () => void;
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
      <button type="button" className="edit-delete-btn" onClick={onDelete}>Delete feature</button>
    </>
  );
}

function EditExisting() {
  const edit = useEditExistingPresenter();
  const sel = edit.selection;

  return (
    <div className="edit-existing">
      <EditModeToggleView
        editMode={edit.editMode}
        onEnter={edit.enter}
        onExit={edit.exit}
        hint="Click a feature on an editable layer to edit it."
      />
      {sel && (
        <EditForm
          key={sel.featureId}
          sel={sel}
          workingGeometry={edit.workingGeometry}
          onSaved={edit.onSaved}
          onCancel={edit.exit}
          onDelete={edit.requestDelete}
        />
      )}
      {sel && edit.error && <p className="edit-form-error" role="alert">{edit.error}</p>}
      <ConfirmDialog
        open={edit.confirmOpen}
        title="Delete feature"
        message="Delete this feature? This cannot be undone."
        confirmLabel="Delete"
        busy={edit.deleting}
        onConfirm={edit.confirmDelete}
        onCancel={edit.cancelDelete}
      />
    </div>
  );
}

// UX gate ONLY. Real authorization is enforced by the backend (401/403 on every
// admin route); a user who forces this open still cannot perform admin API calls.
export default function AdminEditing() {
  return (
    <RequireRole role="admin">
      <EditToolbar />
      <EditExisting />
    </RequireRole>
  );
}
