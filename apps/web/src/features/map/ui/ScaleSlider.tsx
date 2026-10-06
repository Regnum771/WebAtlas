import { useMemo } from 'react';
import { Plus, Minus } from 'lucide-react';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useMapZoom } from '../model/useMapZoom';
import { createCommandExecutor } from '../model/mapCommands';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STOPS,
  nearestStopIndex,
  scaleAtZoom,
  formatScale,
  isNamedStop,
  namedScaleAt,
  stepStopIndex,
} from '../model/zoomScale';

/** Pixels between two neighbouring stops on the track. */
const STOP_SPACING_PX = 28;
const LAST_STOP = ZOOM_STOPS.length - 1;

export interface ScaleSliderViewProps {
  /** Index into ZOOM_STOPS — where the handle sits. */
  stopIndex: number;
  zoom: number;
  scaleText: string;
  /** Set only while the view rests on a named scale. */
  scaleName: string | null;
  onStopChange: (index: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

/** Passive view: a vertical track with one tick per scale stop, the top being the most zoomed in. */
export function ScaleSliderView({
  stopIndex,
  zoom,
  scaleText,
  scaleName,
  onStopChange,
  onZoomIn,
  onZoomOut,
  onReset,
}: ScaleSliderViewProps) {
  const isMinZoom = zoom <= MIN_ZOOM + 0.05;
  const isMaxZoom = zoom >= MAX_ZOOM - 0.05;

  return (
    <div className="scale-control">
      <div className="scale-slider float">
        <button
          type="button"
          className="scale-step"
          aria-label="Phóng to"
          disabled={isMaxZoom}
          onClick={onZoomIn}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <div className="scale-track">
          {ZOOM_STOPS.map((_, index) => (
            <span
              key={index}
              className={`scale-tick${isNamedStop(index) ? ' named' : ''}`}
              style={{ top: `${(LAST_STOP - index) * STOP_SPACING_PX}px` }}
              aria-hidden="true"
            />
          ))}
          {/* vertical-lr + rtl: the minimum sits at the bottom, so the top is the most zoomed in. */}
          <input
            type="range"
            className="scale-range"
            min={0}
            max={LAST_STOP}
            step={1}
            value={stopIndex}
            onChange={(e) => onStopChange(Number(e.currentTarget.value))}
            aria-label="Tỷ lệ bản đồ"
            aria-orientation="vertical"
            aria-valuetext={scaleText}
          />
        </div>
        <button
          type="button"
          className="scale-step"
          aria-label="Thu nhỏ"
          disabled={isMinZoom}
          onClick={onZoomOut}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="scale-readout float">
        <output className="scale-readout-value">{scaleText}</output>
        {scaleName && <span className="scale-readout-name">{scaleName}</span>}
        <button type="button" className="link" onClick={onReset}>
          Toàn vùng
        </button>
      </div>
    </div>
  );
}

/** Container: turns the view's callbacks into `zoomTo` and `resetView` map commands. */
export default function ScaleSlider() {
  const { map, setBasemap, layersState, toggleLayerVisibility, setLayerOpacity } = useMapContext();
  const zoom = useMapZoom();

  const run = useMemo(
    () =>
      createCommandExecutor({
        map,
        setBasemap,
        toggleLayerVisibility,
        setLayerOpacity,
        getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
        layerExists: (id) => layersState.some((l) => l.id === id),
      }),
    [map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState],
  );

  // Clamping to the view's actual min/max happens inside the executor
  // (features/map/model/mapCommands.ts); these only pick the target scale stop.
  const zoomToStop = (index: number) => run({ kind: 'zoomTo', zoom: ZOOM_STOPS[index] });

  return (
    <ScaleSliderView
      stopIndex={nearestStopIndex(zoom)}
      zoom={zoom}
      scaleText={formatScale(scaleAtZoom(zoom))}
      scaleName={namedScaleAt(zoom)}
      onStopChange={zoomToStop}
      onZoomIn={() => zoomToStop(stepStopIndex(zoom, 1))}
      onZoomOut={() => zoomToStop(stepStopIndex(zoom, -1))}
      onReset={() => run({ kind: 'resetView' })}
    />
  );
}
