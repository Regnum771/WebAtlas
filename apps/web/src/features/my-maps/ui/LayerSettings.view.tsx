import { useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog';
import { Dialog } from '../../../shared/ui/Dialog';
import { Message } from '../../../shared/ui/Message';
import { TextField } from '../../../shared/ui/TextField';
import type { FieldEdit } from '../api/workspace.api';
import type { PersonalLayerStyle } from '../model/personalStyle';
import type { LayerRowData } from '../model/useMyMapsPanelPresenter';
import { FieldsEditorView, type FieldRow } from './FieldsEditor.view';

interface Props {
  layer: LayerRowData;
  /** Each write resolves null when done, else the message to show; the form keeps its values. */
  onRename: (title: string) => Promise<string | null>;
  onStyle: (change: Partial<PersonalLayerStyle>) => void;
  onMove: (direction: 'up' | 'down') => Promise<string | null>;
  onSaveFields: (fields: FieldEdit[]) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
  onClose: () => void;
}

const DELETE_COPY = 'Các đối tượng trong lớp sẽ bị xoá. Không khôi phục được.';
const DELETE_DRAFT_COPY = 'Bản nháp sửa lớp sẽ bị huỷ. Không khôi phục được.';

/**
 * The owner's settings of one layer. Colour, width and fill are for free layers (an edit copy is
 * drawn with the official style, a raster has only the row's opacity); the fields editor is for
 * free layers too. The style controls act at once; the other writes wait for their button.
 */
export function LayerSettingsView({ layer, onRename, onStyle, onMove, onSaveFields, onRemove, onClose }: Props) {
  const free = layer.kind === 'free';
  const [title, setTitle] = useState(layer.title);
  const [rows, setRows] = useState<FieldRow[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<'rename' | 'fields' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function rename() {
    if (!title.trim()) {
      setError('Hãy nhập tên lớp.');
      return;
    }
    setBusy('rename');
    setError(await onRename(title));
    setBusy(null);
  }
  async function move(direction: 'up' | 'down') {
    setError(await onMove(direction));
  }
  async function saveFields() {
    if (!rows) return;
    setBusy('fields');
    // A blank row is a row the user added and did not fill.
    const edits = rows.filter((r) => r.name.trim() !== '').map((r) => (r.from === undefined
      ? { name: r.name.trim(), type: r.type }
      : { name: r.name.trim(), type: r.type, from: r.from }));
    const failure = await onSaveFields(edits);
    setBusy(null);
    if (failure === null) setRows(null);
    else setFieldsError(failure);
  }
  async function remove() {
    setBusy('remove');
    setRemoveError(null);
    const failure = await onRemove();
    setBusy(null);
    if (failure === null) onClose();
    else setRemoveError(failure);
  }

  const deleteCopy = layer.kind === 'edit_copy' ? DELETE_DRAFT_COPY : DELETE_COPY;
  return (
    <Dialog open title="Thiết lập lớp" onClose={onClose}>
      <form className="my-maps-settings-row" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
        <TextField id="layer-title" label="Tên lớp" value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} />
        <Button type="submit" busy={busy === 'rename'}>Đổi tên</Button>
      </form>
      {error && <Message tone="error" title={error} />}

      {free && (
        <div className="my-maps-style">
          <div className="field">
            <label htmlFor="layer-color">Màu</label>
            <input id="layer-color" type="color" value={layer.style.color} onChange={(e) => onStyle({ color: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="layer-width">Độ dày nét</label>
            <input
              id="layer-width" type="range" min="1" max="8" step="1" value={layer.style.width}
              onChange={(e) => onStyle({ width: parseFloat(e.target.value) })}
            />
          </div>
          {layer.geometryType === 'polygon' && (
            <div className="field">
              <label htmlFor="layer-fill">Độ đậm vùng</label>
              <input
                id="layer-fill" type="range" min="0" max="1" step="0.05" value={layer.style.fillOpacity}
                onChange={(e) => onStyle({ fillOpacity: parseFloat(e.target.value) })}
              />
            </div>
          )}
        </div>
      )}

      <div className="my-maps-settings-row">
        <Button disabled={layer.isFirst} onClick={() => { void move('up'); }}>Lên</Button>
        <Button disabled={layer.isLast} onClick={() => { void move('down'); }}>Xuống</Button>
      </div>

      {free && (rows === null ? (
        <Button onClick={() => { setFieldsError(null); setRows(layer.fields.map((f) => ({ ...f, from: f.name }))); }}>
          Sửa trường
        </Button>
      ) : (
        <div className="field">
          <span className="my-maps-fields-title">Trường thông tin</span>
          <FieldsEditorView rows={rows} onChange={(next) => { setRows(next); setFieldsError(null); }} />
          {fieldsError && <Message tone="error" title={fieldsError} />}
          <div className="dialog-actions">
            <Button onClick={() => setRows(null)}>Huỷ</Button>
            <Button variant="solid" busy={busy === 'fields'} onClick={() => { void saveFields(); }}>Lưu trường</Button>
          </div>
        </div>
      ))}

      <div className="dialog-actions">
        <Button variant="danger" onClick={() => { setRemoveError(null); setAsking(true); }}>Xoá lớp</Button>
        <Button onClick={onClose}>Đóng</Button>
      </div>
      <ConfirmDialog
        open={asking}
        title="Xoá lớp này?"
        message={removeError ? `${deleteCopy} ${removeError}` : deleteCopy}
        confirmLabel="Xoá"
        irreversible
        busy={busy === 'remove'}
        onConfirm={() => { void remove(); }}
        onCancel={() => setAsking(false)}
      />
    </Dialog>
  );
}
