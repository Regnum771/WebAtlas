import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog';
import { Dialog } from '../../../shared/ui/Dialog';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import { TextField } from '../../../shared/ui/TextField';
import { formatBytes } from '../model/formatBytes';
import type { DialogState, MapCardData } from '../model/useMyMapsPanelPresenter';
import { MapCardView } from './MapCard.view';

interface Props {
  collapsed: boolean;
  loading: boolean;
  error: string | null;
  own: MapCardData[];
  shared: MapCardData[];
  usage: { usageBytes: number; quotaBytes: number } | null;
  dialog: DialogState;
  pendingDelete: boolean;
  deleteError: string | null;
  deleting: boolean;
  onToggleCollapsed: () => void;
  onRetry: () => void;
  onNewMap: () => void;
  onToggleCard: (mapId: string) => void;
  onRename: (mapId: string) => void;
  onAskDelete: (mapId: string) => void;
  /** Opens the upload dialog: into a new map (null) or into the given map. */
  onUpload: (mapId: string | null) => void;
  /** Opens the Tải xuống dialog of a map (owner or recipient). */
  onExport: (mapId: string) => void;
  /** Opens the Chia sẻ dialog of an owned map. */
  onShare: (mapId: string) => void;
  /** Tạo bản sao of a map shared with the user. */
  onCopy: (mapId: string) => void;
  onLayerVisible: (layerId: string, visible: boolean) => void;
  onLayerOpacity: (layerId: string, opacity: number) => void;
  onAddLayer: (mapId: string, kind: 'drawn' | 'edit_copy') => void;
  onLayerSettings: (mapId: string, layerId: string) => void;
  /** Opens the table of one layer of a map. */
  onLayerTable: (mapId: string, layerId: string) => void;
  onDialogTitle: (title: string) => void;
  onDialogSubmit: () => void;
  onDialogClose: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

const DELETE_MESSAGE = 'Các lớp, đối tượng và bản nháp trong bản đồ sẽ bị xoá. Không khôi phục được.';

/** Passive: the Bản của tôi section. Later tasks add their controls beside the buttons. */
export function MyMapsPanelView(p: Props) {
  const Chevron = p.collapsed ? ChevronRight : ChevronDown;
  const cards = (list: MapCardData[]) => (
    <ul className="my-map-list">
      {list.map((card) => (
        <MapCardView
          key={card.id}
          card={card}
          onToggle={() => p.onToggleCard(card.id)}
          onRename={() => p.onRename(card.id)}
          onDelete={() => p.onAskDelete(card.id)}
          onUpload={() => p.onUpload(card.id)}
          onExport={() => p.onExport(card.id)}
          onShare={() => p.onShare(card.id)}
          onCopy={() => p.onCopy(card.id)}
          onLayerVisible={p.onLayerVisible}
          onLayerOpacity={p.onLayerOpacity}
          onAddLayer={(kind) => p.onAddLayer(card.id, kind)}
          onLayerSettings={(layerId) => p.onLayerSettings(card.id, layerId)}
          onLayerTable={(layerId) => p.onLayerTable(card.id, layerId)}
        />
      ))}
    </ul>
  );
  const rename = p.dialog.mode === 'rename';
  return (
    <section className="layers-panel my-maps">
      <h2 className="panel-title">
        <button type="button" className="my-maps-toggle" aria-expanded={!p.collapsed} onClick={p.onToggleCollapsed}>
          <Chevron size={16} aria-hidden="true" />
          Bản của tôi
        </button>
      </h2>
      {!p.collapsed && (
        <>
          {p.loading && <Spinner />}
          {p.error && <Message tone="error" title={p.error} actions={<Button size="sm" onClick={p.onRetry}>Thử lại</Button>} />}
          {!p.loading && !p.error && (
            <>
              <div className="my-maps-buttons">
                <Button size="sm" onClick={p.onNewMap}>Bản đồ mới</Button>
                <Button size="sm" onClick={() => p.onUpload(null)}>Tải tệp lên</Button>
              </div>
              <h3 className="layers-group-title">Của tôi</h3>
              {p.own.length === 0
                ? <p className="my-maps-empty">Chưa có bản đồ nào. Tạo bản đồ mới hoặc tải tệp lên.</p>
                : cards(p.own)}
              {p.usage && (
                <p className="my-maps-quota">
                  Đã dùng {formatBytes(p.usage.usageBytes)} / {formatBytes(p.usage.quotaBytes)}
                </p>
              )}
              <h3 className="layers-group-title">Được chia sẻ với tôi</h3>
              {p.shared.length === 0
                ? <p className="my-maps-empty">Chưa ai chia sẻ bản đồ với anh/chị.</p>
                : cards(p.shared)}
            </>
          )}
        </>
      )}
      <Dialog open={p.dialog.open} title={rename ? 'Đổi tên bản đồ' : 'Bản đồ mới'} onClose={p.onDialogClose}>
        <form onSubmit={(e) => { e.preventDefault(); p.onDialogSubmit(); }}>
          <TextField
            id="my-map-title"
            label="Tên bản đồ"
            value={p.dialog.title}
            error={p.dialog.error}
            onChange={(e) => p.onDialogTitle(e.target.value)}
          />
          <div className="dialog-actions">
            <Button onClick={p.onDialogClose}>Huỷ</Button>
            <Button type="submit" variant="solid" busy={p.dialog.busy}>{rename ? 'Lưu' : 'Tạo'}</Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={p.pendingDelete}
        title="Xoá bản đồ này?"
        message={p.deleteError ? `${DELETE_MESSAGE} ${p.deleteError}` : DELETE_MESSAGE}
        confirmLabel="Xoá"
        irreversible
        busy={p.deleting}
        onConfirm={p.onConfirmDelete}
        onCancel={p.onCancelDelete}
      />
    </section>
  );
}
