import { useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Message } from '../../../shared/ui/Message';
import { TextField } from '../../../shared/ui/TextField';
import type { FieldDef, GeometryType } from '../api/workspace.api';
import { FieldsEditorView, type FieldRow } from './FieldsEditor.view';

export interface NewLayerInput {
  title: string;
  geometryType: GeometryType;
  fields: FieldDef[];
}

interface Props {
  /** Resolves null when the layer was created, else the message to show; the form keeps its values. */
  onSubmit: (input: NewLayerInput) => Promise<string | null>;
  onClose: () => void;
}

/** `Lớp vẽ mới`: a name, a geometry kind and the information fields of the layer. */
export function NewLayerDialogView({ onSubmit, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [geometryType, setGeometryType] = useState<GeometryType>('point');
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) {
      setError('Hãy nhập tên lớp.');
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onSubmit({ title, geometryType, fields: rows.map(({ name, type }) => ({ name, type })) });
    setBusy(false);
    if (failure === null) onClose();
    else setError(failure);
  }

  return (
    <Dialog open title="Lớp vẽ mới" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <TextField id="new-layer-title" label="Tên lớp" value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} />
        <div className="field">
          <label htmlFor="new-layer-geometry">Kiểu hình</label>
          <select
            id="new-layer-geometry"
            className="input"
            value={geometryType}
            onChange={(e) => setGeometryType(e.target.value as GeometryType)}
          >
            <option value="point">Điểm</option>
            <option value="line">Đường</option>
            <option value="polygon">Vùng</option>
          </select>
        </div>
        <div className="field">
          <span className="my-maps-fields-title">Trường thông tin</span>
          <FieldsEditorView rows={rows} onChange={setRows} />
        </div>
        {error && <Message tone="error" title={error} />}
        <div className="dialog-actions">
          <Button onClick={onClose}>Huỷ</Button>
          <Button type="submit" variant="solid" busy={busy}>Tạo lớp</Button>
        </div>
      </form>
    </Dialog>
  );
}
