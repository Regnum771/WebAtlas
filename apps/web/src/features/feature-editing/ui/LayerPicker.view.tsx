export interface LayerPickerViewProps {
  layers: { key: string; geomType: string }[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

// Passive: the editable-layer selector. `layers` comes from the API catalog only.
export function LayerPickerView({ layers, selectedKey, onSelect }: LayerPickerViewProps) {
  return (
    <div className="field">
      <label htmlFor="edit-layer-select">Lớp</label>
      <select
        id="edit-layer-select"
        className="input"
        value={selectedKey ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="" disabled>Chọn lớp…</option>
        {layers.map((l) => (
          <option key={l.key} value={l.key}>{l.key} ({l.geomType})</option>
        ))}
      </select>
    </div>
  );
}
