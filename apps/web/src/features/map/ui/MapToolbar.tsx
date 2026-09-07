import React, { useMemo } from 'react';
import { ZoomIn, ZoomOut, Home, Ruler, Square, MousePointer2, Map as MapIcon, Layers, Mountain } from 'lucide-react';
import type { BasemapName } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useMapZoom } from '../model/useMapZoom';
import { useMeasure, type MeasureMode } from '../model/useMeasure';
import { createCommandExecutor } from '../model/mapCommands';
import { MIN_ZOOM, MAX_ZOOM, ZOOM_SCALE_LEVELS, zoomForScale, scaleAtZoom, formatScale } from '../model/zoomScale';

const BASEMAP_OPTIONS: { id: BasemapName; label: string; icon: React.ReactNode }[] = [
  { id: 'street', label: 'Đường phố', icon: <MapIcon size={18} /> },
  { id: 'satellite', label: 'Vệ tinh', icon: <Layers size={18} /> },
  { id: 'dem', label: 'Địa hình', icon: <Mountain size={18} /> },
];

export interface MapToolbarViewProps {
  zoom: number;
  scaleText: string;
  measureMode: MeasureMode;
  measureValue: string | null;
  activeBasemap?: BasemapName;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onMeasure: (mode: MeasureMode) => void;
  onBasemap: (basemap: BasemapName) => void;
}

/**
 * Passive view — issues nothing itself, only reports the button that was pressed via
 * props. `MapToolbar` (default export below) is the container that turns those
 * callbacks into typed `MapCommand`s.
 */
export function MapToolbarView({
  zoom,
  scaleText,
  measureMode,
  measureValue,
  activeBasemap,
  onZoomIn,
  onZoomOut,
  onReset,
  onMeasure,
  onBasemap,
}: MapToolbarViewProps) {
  const isMinZoom = zoom <= MIN_ZOOM + 0.05;
  const isMaxZoom = zoom >= MAX_ZOOM - 0.05;

  return (
    <div className="map-toolbar">
      {measureValue && <div className="measure-result glass-panel">{measureValue}</div>}

      <div className="glass-panel toolbar-rail">
        <div className="control-group toolbar-col">
          <button
            className={`control-btn ${measureMode === 'none' ? 'active' : ''}`}
            aria-pressed={measureMode === 'none'}
            onClick={() => onMeasure('none')}
            title="Di chuyển bản đồ"
          >
            <MousePointer2 size={18} />
          </button>
          <button
            className={`control-btn ${measureMode === 'length' ? 'active' : ''}`}
            aria-pressed={measureMode === 'length'}
            onClick={() => onMeasure('length')}
            title="Đo chiều dài (sông)"
          >
            <Ruler size={18} />
          </button>
          <button
            className={`control-btn ${measureMode === 'area' ? 'active' : ''}`}
            aria-pressed={measureMode === 'area'}
            onClick={() => onMeasure('area')}
            title="Đo diện tích (ngập)"
          >
            <Square size={18} />
          </button>
        </div>

        <div className="control-divider" />

        <div className="control-group toolbar-col">
          <button
            className={`control-btn ${isMaxZoom ? 'disabled' : ''}`}
            onClick={onZoomIn}
            disabled={isMaxZoom}
            title="Phóng to"
          >
            <ZoomIn size={18} />
          </button>
          <span className="zoom-scale-label">{scaleText}</span>
          <button
            className={`control-btn ${isMinZoom ? 'disabled' : ''}`}
            onClick={onZoomOut}
            disabled={isMinZoom}
            title="Thu nhỏ"
          >
            <ZoomOut size={18} />
          </button>
        </div>

        <div className="control-divider" />

        <button className="control-btn" onClick={onReset} title="Về vùng công tác">
          <Home size={18} />
        </button>

        <div className="control-divider" />

        <div className="control-group toolbar-col">
          {BASEMAP_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`control-btn ${activeBasemap === opt.id ? 'active' : ''}`}
              aria-pressed={activeBasemap === opt.id}
              onClick={() => onBasemap(opt.id)}
              title={opt.label}
            >
              {opt.icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Container: wires `useMapZoom` (zoom readout), `useMeasure` (Draw interaction,
 * quarantined behind `features/map/model`), and `createCommandExecutor` — every
 * button here, including the zoom in/out steppers, issues a `MapCommand` through
 * `run(...)` rather than touching `map.getView()` itself. No `ol` import here —
 * `map` arrives already typed via `useMapContext`, and is only ever handed to
 * `createCommandExecutor`, never called directly.
 */
export default function MapToolbar() {
  const { map, basemap, setBasemap, layersState, toggleLayerVisibility, setLayerOpacity } = useMapContext();
  const zoom = useMapZoom();
  const measure = useMeasure();

  const run = useMemo(
    () =>
      createCommandExecutor({
        map,
        setBasemap,
        toggleLayerVisibility,
        setLayerOpacity,
        getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
      }),
    [map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState],
  );

  // Nấc tỷ lệ tròn số cho zoom in/out — chuyển nguyên từ MapControls cũ (không có slider,
  // chỉ còn hai nút, nhưng cùng logic "bám nấc gần nhất rồi bước sang nấc kế").
  const zoomStops = useMemo(() => ZOOM_SCALE_LEVELS.map((scale) => zoomForScale(scale)).sort((a, b) => a - b), []);

  const nearestStopIndex = useMemo(() => {
    let best = 0;
    for (let i = 1; i < zoomStops.length; i++) {
      if (Math.abs(zoomStops[i] - zoom) < Math.abs(zoomStops[best] - zoom)) {
        best = i;
      }
    }
    return best;
  }, [zoomStops, zoom]);

  const stepZoom = (direction: 1 | -1) => {
    const currentStop = zoomStops[nearestStopIndex];
    const alreadyMoving = direction === 1 ? currentStop > zoom + 0.05 : currentStop < zoom - 0.05;
    const targetIndex = alreadyMoving ? nearestStopIndex : nearestStopIndex + direction;
    const clamped = Math.min(zoomStops.length - 1, Math.max(0, targetIndex));
    // Clamping to the view's actual min/max happens inside the executor
    // (features/map/model/mapCommands.ts) — this only picks the target scale stop.
    run({ kind: 'zoomTo', zoom: zoomStops[clamped] });
  };

  const onMeasure = (mode: MeasureMode) => {
    if (mode === 'none') {
      measure.clear();
    } else {
      measure.start(mode);
    }
  };

  const onReset = () => run({ kind: 'resetView' });
  const onBasemap = (b: BasemapName) => run({ kind: 'setBasemap', basemap: b });

  return (
    <MapToolbarView
      zoom={zoom}
      scaleText={formatScale(scaleAtZoom(zoom))}
      measureMode={measure.mode}
      measureValue={measure.value}
      activeBasemap={basemap}
      onZoomIn={() => stepZoom(1)}
      onZoomOut={() => stepZoom(-1)}
      onReset={onReset}
      onMeasure={onMeasure}
      onBasemap={onBasemap}
    />
  );
}
