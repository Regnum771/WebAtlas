import { useEffect, useRef } from 'react';
import { Button } from '../../../shared/ui/Button';
import { useMeasure, type MeasureMode } from '../model/useMeasure';

type MeasureKind = Exclude<MeasureMode, 'none'>;

const KINDS: { kind: MeasureKind; label: string }[] = [
  { kind: 'length', label: 'Chiều dài' },
  { kind: 'area', label: 'Diện tích' },
];

export interface MeasureToolViewProps {
  mode: MeasureMode;
  value: string | null;
  onMeasure: (kind: MeasureKind) => void;
}

/** Passive view: the two measurements and the current reading. */
export function MeasureToolView({ mode, value, onMeasure }: MeasureToolViewProps) {
  return (
    <div className="tool-section">
      <div className="tool-buttons">
        {KINDS.map(({ kind, label }) => (
          <Button
            key={kind}
            size="sm"
            variant={mode === kind ? 'solid' : 'outline'}
            aria-pressed={mode === kind}
            onClick={() => onMeasure(kind)}
          >
            {label}
          </Button>
        ))}
      </div>
      <output className="measure-value">{value}</output>
    </div>
  );
}

/**
 * Container, and the only caller of `useMeasure` (the Draw interaction is quarantined
 * behind `features/map/model`). `active` is "my menu is open".
 */
export default function MeasureTool({ active }: { active: boolean }) {
  const measure = useMeasure();
  const clearRef = useRef(measure.clear);
  clearRef.current = measure.clear;

  // Closing the menu ends the measurement, which also hands the map's clicks back.
  useEffect(() => {
    if (!active) return;
    return () => clearRef.current();
  }, [active]);

  return (
    <MeasureToolView
      mode={measure.mode}
      value={measure.value}
      onMeasure={(kind) => (measure.mode === kind ? measure.clear() : measure.start(kind))}
    />
  );
}
