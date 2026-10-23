import { useState } from 'react';
import { createPortal } from 'react-dom';
import { EDITABLE_LAYER_KEYS, LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';
import { LAYER_DISPLAY } from '../../entities/layer/layerDisplay';
import { useSession } from '../../entities/session/model/session.store';
import { useLayerEditorPresenter } from './model/useLayerEditorPresenter';
import { useMyMapsPanelPresenter, type MapCardData } from './model/useMyMapsPanelPresenter';
import { usePersonalLayersSync } from './model/usePersonalLayersSync';
import { usePersonalPopupPresenter } from './model/usePersonalPopupPresenter';
import { useExportPresenter } from './model/useExportPresenter';
import { ExportDialogView } from './ui/ExportDialog.view';
import { useSharePresenter } from './model/useSharePresenter';
import { ShareDialogView } from './ui/ShareDialog.view';
import { useUploadPresenter } from './model/useUploadPresenter';
import { usePendingImports, type PendingImport } from './model/pendingImports.store';
import { usePendingImportPresenter } from './model/usePendingImportPresenter';
import { usePersonalEditingPresenter } from './model/usePersonalEditingPresenter';
import { useAttributeFormPresenter } from '../feature-editing/model/useAttributeFormPresenter';
import { AttributeFormView } from '../feature-editing/ui/AttributeForm.view';
import { EditCopyDialogView } from './ui/EditCopyDialog.view';
import { FreeFeatureFormView } from './ui/FreeFeatureForm.view';
import { PersonalEditingView } from './ui/PersonalEditing.view';
import { LayerSettingsView } from './ui/LayerSettings.view';
import { MyMapsPanelView } from './ui/MyMapsPanel.view';
import { NewLayerDialogView } from './ui/NewLayerDialog.view';
import { PersonalFeatureCardView } from './ui/PersonalFeatureCard.view';
import { UploadDialogView } from './ui/UploadDialog.view';

/** The card of a clicked personal feature, portalled to <body>: the side panel would clip it. */
function PersonalFeatureCard() {
  const p = usePersonalPopupPresenter();
  if (!p.card || !p.anchor) return null;
  return createPortal(
    <PersonalFeatureCardView title={p.card.title} rows={p.card.rows} anchor={p.anchor}
      canUseAsRoi={p.canUseAsRoi} onUseAsRoi={p.useAsRoi} onClose={p.close}
    />,
    document.body,
  );
}

/** Follows one import its dialog left while it was still running; renders nothing. */
function PendingImportWatch({ entry }: { entry: PendingImport }) {
  usePendingImportPresenter(entry);
  return null;
}

/** The upload dialog; mounted only while open, so each opening starts idle. */
function UploadDialog({ targetMapId, onClose }: { targetMapId: string | null; onClose: () => void }) {
  const p = useUploadPresenter({ targetMapId });
  const close = () => { p.close(); onClose(); };
  return (
    <UploadDialogView
      phase={p.phase} progress={p.progress} job={p.job} fileName={p.file?.name ?? null} fileError={p.fileError}
      target={p.target} targets={p.targets} sourceCrs={p.sourceCrs} crsRequired={p.crsRequired}
      crsWarning={p.crsWarning} error={p.error} successText={p.successText}
      canSubmit={p.canSubmit} canRetry={p.canRetry}
      onFile={p.setFile} onTarget={p.setTarget} onSourceCrs={p.setSourceCrs}
      onSubmit={() => { void p.submit(); }} onRetry={() => { void p.retry(p.sourceCrs); }} onClose={close}
    />
  );
}

/** The export dialog of one map; mounted only while open, so each opening starts fresh. */
function ExportDialog({ mapId, onClose }: { mapId: string; onClose: () => void }) {
  const p = useExportPresenter({ mapId });
  return (
    <ExportDialogView
      loading={p.loading} format={p.format} crs={p.crs} layers={p.layers} preview={p.preview}
      previewError={p.previewError} warnings={p.warnings} job={p.job} error={p.error}
      queueing={p.queueing} canSubmit={p.canSubmit} files={p.files} listError={p.listError}
      downloadingId={p.downloading} deletingId={p.deleting}
      onFormat={p.setFormat} onCrs={p.setCrs} onLayer={p.toggleLayer}
      onSubmit={() => { void p.submit(); }} onDownload={(id) => { void p.download(id); }}
      onDelete={(id) => { void p.remove(id); }} onClose={onClose}
    />
  );
}

/** The Chia sẻ dialog of one owned map; mounted only while open, so each opening starts fresh. */
function ShareDialog({ mapId, onClose }: { mapId: string; onClose: () => void }) {
  const p = useSharePresenter({ mapId, onGone: onClose });
  return (
    <ShareDialogView
      query={p.query} results={p.results} searching={p.searching} searchError={p.searchError}
      shares={p.shares} loadError={p.loadError} error={p.error} busy={p.busy}
      pendingRevoke={p.pendingRevoke} revoking={p.revoking}
      onQuery={p.setQuery} onShare={(target) => { void p.share(target); }} onAskRevoke={p.askRevoke}
      onConfirmRevoke={() => { void p.confirmRevoke(); }} onCancelRevoke={p.cancelRevoke} onClose={onClose}
    />
  );
}

const OFFICIAL_OPTIONS = EDITABLE_LAYER_KEYS.map((key) => ({
  key,
  name: LAYER_DISPLAY[LAYER_ATTRIBUTE_MAP[key].layerStateId].name,
}));

type LayerDialog =
  | { kind: 'drawn'; mapId: string }
  | { kind: 'edit_copy'; mapId: string }
  | { kind: 'settings'; mapId: string; layerId: string };

/** The layer dialogs of one map; mounted only while one is open, so each opening starts fresh. */
function LayerDialogs({ dialog, cards, onClose }: { dialog: LayerDialog; cards: MapCardData[]; onClose: () => void }) {
  const editor = useLayerEditorPresenter(dialog.mapId);
  if (dialog.kind === 'drawn') return <NewLayerDialogView onSubmit={editor.createDrawn} onClose={onClose} />;
  if (dialog.kind === 'edit_copy') {
    return <EditCopyDialogView options={OFFICIAL_OPTIONS} onSubmit={editor.createEditCopy} onClose={onClose} />;
  }
  const layer = cards.find((c) => c.id === dialog.mapId)?.layers?.find((l) => l.id === dialog.layerId);
  // The layer left the map (deleted, or the map changed elsewhere): nothing left to set.
  if (!layer) return null;
  const { layerId } = dialog;
  return (
    <LayerSettingsView
      layer={layer}
      onRename={(title) => editor.rename(layerId, title)}
      onStyle={(change) => editor.setStyle(layerId, change)}
      onMove={(direction) => editor.move(layerId, direction)}
      onSaveFields={(fields) => editor.saveFields(layerId, fields)}
      onRemove={() => editor.remove(layerId)}
      onClose={onClose}
    />
  );
}

type Editing = ReturnType<typeof usePersonalEditingPresenter>;

/**
 * An edit copy's feature in the official attribute form, saved through the workspace route; the
 * managing unit may be any unit (the jurisdiction check comes when the draft is submitted).
 */
function EditCopyForm({ editing, copy }: { editing: Editing; copy: NonNullable<Editing['editCopy']> }) {
  const form = useAttributeFormPresenter({
    layerKey: copy.layerKey, attributes: copy.attributes, geometry: editing.geometryToSave,
    mode: copy.featureId ? 'edit' : 'create', featureId: copy.featureId, initialValues: copy.initialValues,
    onSaved: editing.onSaved, save: editing.saveEditCopy, anyUnit: true,
  });
  return (
    <AttributeFormView
      attributes={copy.attributes} labels={form.labels} values={form.values} fieldErrors={form.fieldErrors}
      error={form.error} errorDetail={form.errorDetail} canSave={form.canSave} saving={form.saving}
      managingUnit={form.managingUnit} onField={form.setField} onSubmit={() => { void form.submit(); }} onCancel={editing.leave}
    />
  );
}

/** The open feature's form: a free layer's own fields, or an edit copy's official attributes. */
function FeatureForm({ editing }: { editing: Editing }) {
  if (editing.targetKind === 'free') {
    return (
      <FreeFeatureFormView
        fields={editing.freeFields} values={editing.freeValues} error={editing.freeError} saving={editing.saving}
        onField={editing.setFreeValue} onSubmit={() => { void editing.submitFree(); }} onCancel={editing.leave}
      />
    );
  }
  // Keyed per feature: the form seeds its values once.
  if (editing.editCopy) return <EditCopyForm key={editing.targetKey} editing={editing} copy={editing.editCopy} />;
  return null;
}

/** Vẽ thêm and Sửa đối tượng on an owner's expanded card; one mode at a time for the whole section. */
function CardEditor({ editing, mapId }: { editing: Editing; mapId: string }) {
  const active = editing.mapId === mapId;
  return (
    <PersonalEditingView
      active={active} kind={editing.kind} step={editing.step} layers={editing.drawable} drawShape={editing.drawShape}
      isNew={editing.isNew} reshaping={editing.reshaping}
      confirmOpen={active && editing.confirmOpen} deleting={editing.deleting} error={editing.error}
      onDraw={() => editing.startDrawMode(mapId)} onEdit={() => editing.startEditMode(mapId)}
      onPick={editing.pickLayer} onLeave={editing.leave} onReshape={editing.reshape}
      onAskDelete={editing.requestDelete} onConfirmDelete={() => { void editing.confirmDelete(); }}
      onCancelDelete={editing.cancelDelete}
    >
      {active && editing.step === 'form' && <FeatureForm editing={editing} />}
    </PersonalEditingView>
  );
}

function MyMapsPanel() {
  usePersonalLayersSync();
  const p = useMyMapsPanelPresenter();
  const editing = usePersonalEditingPresenter();
  const pendingImports = usePendingImports();
  const [layerDialog, setLayerDialog] = useState<LayerDialog | null>(null);
  const [upload, setUpload] = useState<{ targetMapId: string | null } | null>(null);
  const [exportMapId, setExportMapId] = useState<string | null>(null);
  const [shareMapId, setShareMapId] = useState<string | null>(null);
  return (
    <>
      <MyMapsPanelView
        collapsed={p.collapsed} loading={p.loading} error={p.error}
        own={p.own} shared={p.shared} usage={p.usage}
        dialog={p.dialog} pendingDelete={p.pendingDelete} deleteError={p.deleteError} deleting={p.deleting}
        onToggleCollapsed={p.toggleCollapsed} onRetry={p.retry} onNewMap={p.openCreate}
        onToggleCard={p.toggleExpanded} onRename={p.openRename} onAskDelete={p.askDelete}
        onUpload={(targetMapId) => setUpload({ targetMapId })}
        onExport={setExportMapId}
        onShare={setShareMapId}
        onCopy={(mapId) => { void p.copy(mapId); }}
        onLayerVisible={p.setLayerVisible} onLayerOpacity={p.setLayerOpacity}
        onAddLayer={(mapId, kind) => setLayerDialog({ kind, mapId } as LayerDialog)}
        onLayerSettings={(mapId, layerId) => setLayerDialog({ kind: 'settings', mapId, layerId })}
        renderEditor={(card) => <CardEditor editing={editing} mapId={card.id} />}
        onDialogTitle={p.setTitle} onDialogSubmit={() => { void p.submit(); }} onDialogClose={p.closeDialog}
        onConfirmDelete={() => { void p.confirmDelete(); }} onCancelDelete={p.cancelDelete}
      />
      {layerDialog && <LayerDialogs dialog={layerDialog} cards={[...p.own, ...p.shared]} onClose={() => setLayerDialog(null)} />}
      {upload && <UploadDialog targetMapId={upload.targetMapId} onClose={() => setUpload(null)} />}
      {exportMapId && <ExportDialog mapId={exportMapId} onClose={() => setExportMapId(null)} />}
      {shareMapId && <ShareDialog mapId={shareMapId} onClose={() => setShareMapId(null)} />}
      <PersonalFeatureCard />
      {pendingImports.map((entry) => <PendingImportWatch key={entry.jobId} entry={entry} />)}
    </>
  );
}

/**
 * The Bản của tôi section, with its layers on the map and the feature card; an anonymous
 * visitor sees nothing, and no request is made.
 */
export default function MyMaps() {
  const { status } = useSession();
  if (status !== 'authenticated') return null;
  return <MyMapsPanel />;
}
