import { LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { RequireRole } from '../auth/ui/RequireRole';
import { useMapEditing } from '../map/model/mapEditing';
import { useEditToolbarPresenter } from './model/useEditToolbarPresenter';
import { useAttributeFormPresenter } from './model/useAttributeFormPresenter';
import { EditToolbarView } from './ui/EditToolbar.view';
import { LayerPickerView } from './ui/LayerPicker.view';
import { DrawControlsView } from './ui/DrawControls.view';
import { AttributeFormView } from './ui/AttributeForm.view';

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

// UX gate ONLY. Real authorization is enforced by the backend (401/403 on every
// write route); a viewer who forces this open still gets 403 on the API call.
// Editors and admins can edit features (design §2 CAN_WRITE_FEATURES).
//
// Editing an already-selected feature (the pen, the attribute form, delete) lives in
// widgets/display-panel now — the panel IS the editing surface for a selected feature.
// This drawer only hosts the draw/create flow.
export default function FeatureEditing() {
  return (
    <RequireRole role={['admin', 'editor']}>
      <EditToolbar />
    </RequireRole>
  );
}
