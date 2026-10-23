import { useSession } from '../../entities/session/model/session.store';
import { useMyMapsPanelPresenter } from './model/useMyMapsPanelPresenter';
import { MyMapsPanelView } from './ui/MyMapsPanel.view';

function MyMapsPanel() {
  const p = useMyMapsPanelPresenter();
  return (
    <MyMapsPanelView
      collapsed={p.collapsed} loading={p.loading} error={p.error}
      own={p.own} shared={p.shared} usage={p.usage}
      dialog={p.dialog} pendingDelete={p.pendingDelete} deleteError={p.deleteError} deleting={p.deleting}
      onToggleCollapsed={p.toggleCollapsed} onRetry={p.retry} onNewMap={p.openCreate}
      onToggleCard={p.toggleExpanded} onRename={p.openRename} onAskDelete={p.askDelete}
      onLayerVisible={p.setLayerVisible} onLayerOpacity={p.setLayerOpacity}
      onDialogTitle={p.setTitle} onDialogSubmit={() => { void p.submit(); }} onDialogClose={p.closeDialog}
      onConfirmDelete={() => { void p.confirmDelete(); }} onCancelDelete={p.cancelDelete}
    />
  );
}

/** The Bản của tôi section; an anonymous visitor sees nothing, and no request is made. */
export default function MyMaps() {
  const { status } = useSession();
  if (status !== 'authenticated') return null;
  return <MyMapsPanel />;
}
