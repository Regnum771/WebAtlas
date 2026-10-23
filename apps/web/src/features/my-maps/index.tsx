import { useState } from 'react';
import { createPortal } from 'react-dom';
import { EDITABLE_LAYER_KEYS, LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';
import { LAYER_DISPLAY } from '../../entities/layer/layerDisplay';
import { useSession } from '../../entities/session/model/session.store';
import { useLayerEditorPresenter } from './model/useLayerEditorPresenter';
import { useMyMapsPanelPresenter, type MapCardData } from './model/useMyMapsPanelPresenter';
import { usePersonalLayersSync } from './model/usePersonalLayersSync';
import { usePersonalPopupPresenter } from './model/usePersonalPopupPresenter';
import { useUploadPresenter } from './model/useUploadPresenter';
import { EditCopyDialogView } from './ui/EditCopyDialog.view';
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
    <PersonalFeatureCardView title={p.card.title} rows={p.card.rows} anchor={p.anchor} onClose={p.close} />,
    document.body,
  );
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

function MyMapsPanel() {
  usePersonalLayersSync();
  const p = useMyMapsPanelPresenter();
  const [layerDialog, setLayerDialog] = useState<LayerDialog | null>(null);
  const [upload, setUpload] = useState<{ targetMapId: string | null } | null>(null);
  return (
    <>
      <MyMapsPanelView
        collapsed={p.collapsed} loading={p.loading} error={p.error}
        own={p.own} shared={p.shared} usage={p.usage}
        dialog={p.dialog} pendingDelete={p.pendingDelete} deleteError={p.deleteError} deleting={p.deleting}
        onToggleCollapsed={p.toggleCollapsed} onRetry={p.retry} onNewMap={p.openCreate}
        onToggleCard={p.toggleExpanded} onRename={p.openRename} onAskDelete={p.askDelete}
        onUpload={(targetMapId) => setUpload({ targetMapId })}
        onLayerVisible={p.setLayerVisible} onLayerOpacity={p.setLayerOpacity}
        onAddLayer={(mapId, kind) => setLayerDialog({ kind, mapId } as LayerDialog)}
        onLayerSettings={(mapId, layerId) => setLayerDialog({ kind: 'settings', mapId, layerId })}
        onDialogTitle={p.setTitle} onDialogSubmit={() => { void p.submit(); }} onDialogClose={p.closeDialog}
        onConfirmDelete={() => { void p.confirmDelete(); }} onCancelDelete={p.cancelDelete}
      />
      {layerDialog && <LayerDialogs dialog={layerDialog} cards={[...p.own, ...p.shared]} onClose={() => setLayerDialog(null)} />}
      {upload && <UploadDialog targetMapId={upload.targetMapId} onClose={() => setUpload(null)} />}
      <PersonalFeatureCard />
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
