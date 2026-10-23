import { useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Message } from '../../../shared/ui/Message';

export interface OfficialLayerOption {
  key: string;
  name: string;
}

interface Props {
  options: OfficialLayerOption[];
  /** Resolves null when the copy was created, else the message to show. */
  onSubmit: (layerKey: string) => Promise<string | null>;
  onClose: () => void;
}

/** `Sửa một lớp chính thức`: pick one of the editable official layers; the API names the copy. */
export function EditCopyDialogView({ options, onSubmit, onClose }: Props) {
  const [layerKey, setLayerKey] = useState(options[0]?.key ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const failure = await onSubmit(layerKey);
    setBusy(false);
    if (failure === null) onClose();
    else setError(failure);
  }

  return (
    <Dialog open title="Sửa một lớp chính thức" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="field">
          <label htmlFor="edit-copy-layer">Lớp chính thức</label>
          <select id="edit-copy-layer" className="input" value={layerKey} onChange={(e) => setLayerKey(e.target.value)}>
            {options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
          </select>
        </div>
        {error && <Message tone="error" title={error} />}
        <div className="dialog-actions">
          <Button onClick={onClose}>Huỷ</Button>
          <Button type="submit" variant="solid" busy={busy}>Tạo bản sửa</Button>
        </div>
      </form>
    </Dialog>
  );
}
