import { useMemo } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
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
import { Slider } from '../../../shared/ui/shadcn/slider';
import { IconButton } from '../../../shared/ui/IconButton';

const LAST_STOP = ZOOM_STOPS.length - 1;
/** The thumb's width; Radix keeps the thumb inside the track, so a tick must follow the same offset. */
const THUMB_PX = 12;

/** Where stop `index` sits along the track, matching the centre Radix gives the thumb there. */
export function stopPosition(index: number): string {
  const percent = (index / LAST_STOP) * 100;
  const offset = Math.round((THUMB_PX / 2) * (1 - percent / 50) * 100) / 100;
  return `calc(${percent}% ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}px)`;
}

/** The named stops as [ZOOM_STOPS index, name], zoomed out first. */
const NAMED_STOPS: [number, string][] = ZOOM_STOPS.flatMap((zoom, index) => {
  const name = isNamedStop(index) ? namedScaleAt(zoom) : null;
  return name ? [[index, name] as [number, string]] : [];
});

export interface ScaleSliderViewProps {
  /** Index into ZOOM_STOPS: where the thumb sits. */
  stopIndex: number;
  scaleText: string;
  /** Set only while the view rests on a named scale. */
  scaleName: string | null;
  onStopChange: (index: number) => void;
}

/**
 * Passive view for the status bar: the scale readout, then a horizontal track with one tick per
 * stop (zoomed out on the left), the two named stops heavier and labelled.
 */
export function ScaleSliderView({ stopIndex, scaleText, scaleName, onStopChange }: ScaleSliderViewProps) {
  return (
    <div data-slot="scale-slider" className="flex min-w-0 items-center gap-3">
      <output
        className="min-w-[92px] font-num text-num whitespace-nowrap text-ink"
        aria-live="polite"
      >
        {scaleText}
        {scaleName && <span className="ml-1.5 font-ui text-label text-ink-2">{scaleName}</span>}
      </output>
      <div className="relative h-7 w-44 shrink-0 pr-2">
        <div className="absolute inset-x-0 top-0 h-4" aria-hidden="true">
          {ZOOM_STOPS.map((_, index) => (
            <span
              key={index}
              data-tick={isNamedStop(index) ? 'named' : 'plain'}
              className="absolute top-1 h-2 w-px -translate-x-1/2 bg-line data-[tick=named]:top-0.5 data-[tick=named]:h-3 data-[tick=named]:bg-ink"
              style={{ left: stopPosition(index) }}
            />
          ))}
        </div>
        <Slider
          className="absolute inset-x-0 top-0"
          min={0}
          max={LAST_STOP}
          step={1}
          value={[stopIndex]}
          onValueChange={([v]) => onStopChange(v)}
          thumbLabel="Tỷ lệ bản đồ"
          thumbValueText={scaleName ? `${scaleText}, ${scaleName}` : scaleText}
        />
        {/* The two named stops are neighbours: the first name ends at its tick, the second starts at its own. */}
        {NAMED_STOPS.map(([index, name], i) => (
          <span
            key={index}
            aria-hidden="true"
            className="absolute bottom-0 text-[10px] leading-3 whitespace-nowrap text-ink-2"
            style={i === 0
              ? { right: `calc(100% - ${stopPosition(index)} + 3px)` }
              : { left: `calc(${stopPosition(index)} + 3px)` }}
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface ZoomControlsViewProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

/** The first stack of map tools at the top right: zoom in, zoom out, the whole work area. */
export function ZoomControlsView({ zoom, onZoomIn, onZoomOut, onReset }: ZoomControlsViewProps) {
  return (
    <div role="group" aria-label="Phóng to, thu nhỏ" data-slot="tool-stack" className="flex flex-col gap-1">
      <IconButton label="Phóng to" disabled={zoom >= MAX_ZOOM - 0.05} onClick={onZoomIn}>
        <Plus size={16} aria-hidden="true" />
      </IconButton>
      <IconButton label="Thu nhỏ" disabled={zoom <= MIN_ZOOM + 0.05} onClick={onZoomOut}>
        <Minus size={16} aria-hidden="true" />
      </IconButton>
      <IconButton label="Toàn vùng" onClick={onReset}>
        <Maximize2 size={15} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

/** The map commands both containers need: `zoomTo` a stop and `resetView`. */
function useScaleCommands() {
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
  return { zoom, zoomToStop, reset: () => run({ kind: 'resetView' }) };
}

/** Container for the status bar's scale readout and slider. */
export default function ScaleSlider() {
  const { zoom, zoomToStop } = useScaleCommands();
  return (
    <ScaleSliderView
      stopIndex={nearestStopIndex(zoom)}
      scaleText={formatScale(scaleAtZoom(zoom))}
      scaleName={namedScaleAt(zoom)}
      onStopChange={zoomToStop}
    />
  );
}

/** Container for the zoom stack. */
export function ZoomControls() {
  const { zoom, zoomToStop, reset } = useScaleCommands();
  return (
    <ZoomControlsView
      zoom={zoom}
      onZoomIn={() => zoomToStop(stepStopIndex(zoom, 1))}
      onZoomOut={() => zoomToStop(stepStopIndex(zoom, -1))}
      onReset={reset}
    />
  );
}
