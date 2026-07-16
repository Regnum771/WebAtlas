export interface LayerPickerViewProps {
  layers: { key: string; geomType: string }[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

// Passive: the editable-layer selector. `layers` comes from the API catalog only.
export function LayerPickerView({ layers, selectedKey, onSelect }: LayerPickerViewProps) {
  return (
    <div className="edit-layer-picker">
      <label htmlFor="edit-layer-select">Layer</label>
      <select
        id="edit-layer-select"
        value={selectedKey ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="" disabled>Select a layer…</option>
        {layers.map((l) => (
          <option key={l.key} value={l.key}>{l.key} ({l.geomType})</option>
        ))}
      </select>
    </div>
  );
}
