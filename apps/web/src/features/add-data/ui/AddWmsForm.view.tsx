import { useRef, type FormEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { TextField } from '../../../shared/ui/TextField';
import { useFormFields } from '../../../shared/ui/useFormFields';
import { validateLayerName, validateWmsUrl } from '../model/validation';

export interface AddWmsFormViewProps {
  onAdd: (layer: { url: string; layerName: string }) => void;
}

/**
 * Passive form: owns only its two fields. `onAdd` is called with trimmed values once both
 * are valid, and the fields then clear for the next layer.
 */
export function AddWmsFormView({ onAdd }: AddWmsFormViewProps) {
  const fields = useFormFields({ url: '', layerName: '' }, { url: validateWmsUrl, layerName: validateLayerName });
  const urlRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLInputElement>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const firstBad = fields.validateAll();
    if (firstBad) {
      (firstBad === 'url' ? urlRef : layerRef).current?.focus();
      return;
    }
    onAdd({ url: fields.values.url.trim(), layerName: fields.values.layerName.trim() });
    fields.set('url', '');
    fields.set('layerName', '');
  };

  return (
    <form className="tool-section" noValidate onSubmit={onSubmit}>
      <h3 className="tool-heading">Thêm lớp WMS</h3>
      <TextField
        ref={urlRef}
        id="wms-url"
        label="Địa chỉ dịch vụ WMS"
        inputMode="url"
        placeholder="https://…/wms"
        value={fields.values.url}
        error={fields.errors.url}
        onChange={(e) => fields.set('url', e.target.value)}
        onBlur={() => fields.blur('url')}
      />
      <TextField
        ref={layerRef}
        id="wms-layer"
        label="Tên lớp"
        placeholder="workspace:tên_lớp"
        value={fields.values.layerName}
        error={fields.errors.layerName}
        onChange={(e) => fields.set('layerName', e.target.value)}
        onBlur={() => fields.blur('layerName')}
      />
      <div className="tool-buttons">
        <Button type="submit" variant="solid">Thêm vào bản đồ</Button>
      </div>
    </form>
  );
}
