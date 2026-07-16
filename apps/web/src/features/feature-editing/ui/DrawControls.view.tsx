export interface DrawControlsViewProps {
  geomType: string | null;
  mode: 'idle' | 'drawing' | 'form';
  onStartDraw: () => void;
  onCancel: () => void;
}

// Passive: draw / cancel controls + hint text.
export function DrawControlsView({ geomType, mode, onStartDraw, onCancel }: DrawControlsViewProps) {
  return (
    <div className="edit-draw-controls">
      <button type="button" onClick={onStartDraw} disabled={!geomType || mode !== 'idle'}>
        {mode === 'drawing' ? 'Drawing…' : 'Draw'}
      </button>
      {mode !== 'idle' && (
        <button type="button" onClick={onCancel}>Cancel</button>
      )}
      {geomType && mode === 'idle' && <p className="edit-hint">Click Draw, then place a {geomType} on the map.</p>}
      {mode === 'drawing' && <p className="edit-hint">Draw the {geomType} on the map to continue.</p>}
    </div>
  );
}
