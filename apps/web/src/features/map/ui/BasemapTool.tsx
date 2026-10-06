import type { BasemapName } from '@webatlas/shared';
import { Button } from '../../../shared/ui/Button';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useMapCommands } from '../model/useMapCommands';

const BASEMAP_OPTIONS: { id: BasemapName; label: string }[] = [
  { id: 'street', label: 'Đường phố' },
  { id: 'satellite', label: 'Vệ tinh' },
  { id: 'dem', label: 'Địa hình' },
];

export interface BasemapToolViewProps {
  active?: BasemapName;
  onBasemap: (basemap: BasemapName) => void;
}

/** Passive view: the basemaps as one radio group; the one in use is filled. */
export function BasemapToolView({ active, onBasemap }: BasemapToolViewProps) {
  return (
    <div className="tool-buttons" role="radiogroup" aria-label="Nền bản đồ">
      {BASEMAP_OPTIONS.map((opt) => (
        <Button
          key={opt.id}
          size="sm"
          variant={active === opt.id ? 'solid' : 'outline'}
          role="radio"
          aria-checked={active === opt.id}
          onClick={() => onBasemap(opt.id)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

/** Container: a press becomes a `setBasemap` map command; nothing here touches the map itself. */
export default function BasemapTool() {
  const { basemap } = useMapContext();
  const run = useMapCommands();
  return <BasemapToolView active={basemap} onBasemap={(b) => run({ kind: 'setBasemap', basemap: b })} />;
}
