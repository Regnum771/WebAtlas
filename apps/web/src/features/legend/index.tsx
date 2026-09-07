import { legendFor, LEGEND_ATTRIBUTION } from '@webatlas/shared';
import { useMapContext } from '../../app/providers/MapProvider';
import { LAYER_DISPLAY } from '../../entities/layer/layerDisplay';
import { LegendView, type LegendLayer } from './ui/Legend.view';

export default function Legend() {
  const { layersState } = useMapContext();

  const layers: LegendLayer[] = layersState
    .filter((l) => l.visible)
    .map((l) => ({
      layerStateId: l.id,
      name: LAYER_DISPLAY[l.id]?.name ?? l.id,
      sections: legendFor(l.id),
      attribution: LEGEND_ATTRIBUTION[l.id],
    }))
    .filter((l) => l.sections.length > 0);

  return <LegendView layers={layers} />;
}
