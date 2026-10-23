import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../../entities/session/model/session.store';
import { useMyMapsPanelPresenter } from './model/useMyMapsPanelPresenter';
import { usePersonalLayersSync } from './model/usePersonalLayersSync';
import { usePersonalPopupPresenter } from './model/usePersonalPopupPresenter';
import { useUploadPresenter } from './model/useUploadPresenter';
import { MyMapsPanelView } from './ui/MyMapsPanel.view';
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
      phase={p.phase} progress={p.progress} job={p.job} fileError={p.fileError}
      target={p.target} targets={p.targets} sourceCrs={p.sourceCrs} crsRequired={p.crsRequired}
      crsWarning={p.crsWarning} error={p.error} successText={p.successText}
      canSubmit={p.canSubmit} canRetry={p.canRetry}
      onFile={p.setFile} onTarget={p.setTarget} onSourceCrs={p.setSourceCrs}
      onSubmit={() => { void p.submit(); }} onRetry={() => { void p.retry(p.sourceCrs); }} onClose={close}
    />
  );
}

function MyMapsPanel() {
  usePersonalLayersSync();
  const p = useMyMapsPanelPresenter();
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
        onDialogTitle={p.setTitle} onDialogSubmit={() => { void p.submit(); }} onDialogClose={p.closeDialog}
        onConfirmDelete={() => { void p.confirmDelete(); }} onCancelDelete={p.cancelDelete}
      />
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
