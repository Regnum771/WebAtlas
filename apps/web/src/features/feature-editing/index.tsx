import { useEffect, useRef, useState } from 'react';
import { COUNTRY_UNIT, LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { RequireSaveDirectly } from '../auth/ui/RequireSaveDirectly';
import { useCan } from '../../entities/session/model/useCan';
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
import { Button } from '../../shared/ui/Button';
import { Message } from '../../shared/ui/Message';

/** `active` is "the Biên tập menu is open"; `onBusy` hears whether this part holds a drawing or edit mode. */
interface PartProps {
  active: boolean;
  onBusy: (busy: boolean) => void;
}

function EditToolbar({ active, onBusy }: PartProps) {
  const toolbar = useEditToolbarPresenter();
  const { refreshLayer } = useMapEditing();
  const selected = toolbar.layers.find((l) => l.key === toolbar.selectedKey) ?? null;

  // Closing the menu, or unmounting when the session ends, cancels a drawing in
  // progress and its unsaved form, so the map's clicks are free again.
  const cancelRef = useRef(toolbar.cancel);
  cancelRef.current = toolbar.cancel;
  useEffect(() => {
    if (!active) return;
    return () => cancelRef.current();
  }, [active]);

  // The drawn shape stays on the map until its form is saved or cancelled.
  const busy = toolbar.mode !== 'idle';
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);

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
          fields={form.fields}
          fieldErrors={form.fieldErrors}
          error={form.error}
          errorDetail={form.errorDetail}
          canSave={form.canSave}
          saving={form.saving}
          managingUnit={form.managingUnit}
          onField={form.setField}
          onSubmit={form.submit}
          onCancel={toolbar.cancel}
        />
      )}
    </EditToolbarView>
  );
}

function EditForm({ sel, geometryToSave, onSaved, onCancel, onDelete }: {
  sel: NonNullable<ReturnType<typeof useEditExistingPresenter>['selection']>;
  /** Null unless the user changed the geometry: see geometryChanged in useEditExistingPresenter. */
  geometryToSave: GeoJSONGeometry | null;
  onSaved: () => void; onCancel: () => void; onDelete: () => void;
}) {
  const form = useAttributeFormPresenter({
    layerKey: sel.layerKey, attributes: sel.attributes, geometry: geometryToSave,
    mode: 'edit', featureId: sel.featureId, initialValues: sel.initialValues, onSaved,
  });
  // UX gate only (the API checks on DELETE): a delete publishes at once until P4, so Xoá needs
  // feature.delete AND submission.review on the feature's unit; a missing unit counts as VN.
  const can = useCan();
  const unit = sel.initialValues.managing_unit || COUNTRY_UNIT;
  const canDelete = can('feature.delete', unit) && can('submission.review', unit);
  return (
    <>
      <AttributeFormView
        attributes={sel.attributes} labels={form.labels} values={form.values} fields={form.fields}
        fieldErrors={form.fieldErrors} error={form.error} errorDetail={form.errorDetail} canSave={form.canSave}
        saving={form.saving} managingUnit={form.managingUnit} onField={form.setField} onSubmit={form.submit} onCancel={onCancel}
      />
      {canDelete && <Button variant="danger" onClick={onDelete}>Xoá đối tượng</Button>}
    </>
  );
}

function EditExisting({ active, onBusy }: PartProps) {
  const edit = useEditExistingPresenter();
  const sel = edit.selection;

  // Closing the menu, or unmounting when the session ends, leaves edit-existing mode,
  // which would otherwise keep suppressing popups and region picks.
  const latest = useRef(edit);
  latest.current = edit;
  useEffect(() => {
    if (!active) return;
    return () => {
      if (latest.current.editMode) latest.current.exit();
    };
  }, [active]);

  useEffect(() => {
    onBusy(edit.editMode);
    return () => onBusy(false);
  }, [edit.editMode, onBusy]);

  return (
    <div className="edit-existing">
      <EditModeToggleView
        editMode={edit.editMode}
        onEnter={edit.enter}
        onExit={edit.exit}
        hint="Bấm một đối tượng trên bản đồ để sửa."
      />
      {sel && (
        <EditForm
          /* key remounts EditForm per selection so the form re-seeds initialValues (useState initializer runs once) */
          key={sel.featureId}
          sel={sel}
          geometryToSave={edit.geometryToSave}
          onSaved={edit.onSaved}
          onCancel={edit.exit}
          onDelete={edit.requestDelete}
        />
      )}
      {sel && edit.error && <Message tone="error" title={edit.error}>{edit.errorDetail}</Message>}
      <ConfirmDialog
        open={edit.confirmOpen}
        title="Xoá đối tượng này?"
        message="Không khôi phục được."
        confirmLabel="Xoá"
        irreversible
        busy={edit.deleting}
        onConfirm={edit.confirmDelete}
        onCancel={edit.cancelDelete}
      />
    </div>
  );
}

export interface FeatureEditingProps {
  /** The Biên tập menu is open. Closing it cancels a drawing and leaves edit-existing mode. */
  active: boolean;
  /** Hears whether a feature drawing or edit-existing mode is active. */
  onBusyChange?: (busy: boolean) => void;
}

// UX gate ONLY. Real authorization is enforced by the backend: on every write the API
// checks jurisdiction and review rights for the feature's managing unit (403 otherwise).
export default function FeatureEditing({ active, onBusyChange }: FeatureEditingProps) {
  const [drawing, setDrawing] = useState(false);
  const [editing, setEditing] = useState(false);
  const busy = drawing || editing;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  return (
    <RequireSaveDirectly>
      <EditToolbar active={active} onBusy={setDrawing} />
      <EditExisting active={active} onBusy={setEditing} />
    </RequireSaveDirectly>
  );
}
