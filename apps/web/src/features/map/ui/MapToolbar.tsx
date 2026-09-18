import React, { useMemo, type ReactNode } from 'react';
import { ZoomIn, ZoomOut, Home, Ruler, Square, MousePointer2, Map as MapIcon, Layers, Mountain } from 'lucide-react';
import type { BasemapName } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useMapZoom } from '../model/useMapZoom';
import { useMeasure, type MeasureMode } from '../model/useMeasure';
import { createCommandExecutor } from '../model/mapCommands';
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STOPS, nearestStopIndex, scaleAtZoom, formatScale } from '../model/zoomScale';

const BASEMAP_OPTIONS: { id: BasemapName; label: string; icon: React.ReactNode }[] = [
  { id: 'street', label: 'Đường phố', icon: <MapIcon size={18} /> },
  { id: 'satellite', label: 'Vệ tinh', icon: <Layers size={18} /> },
  { id: 'dem', label: 'Địa hình', icon: <Mountain size={18} /> },
];

export interface MapToolbarViewProps {
  /** The rail flyout is open, so the pill must re-centre over the narrower map area. */
  flyoutOpen: boolean;
  /** Index into ZOOM_STOPS — where the handle sits. */
  stopIndex: number;
  onStopChange: (index: number) => void;
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
  /** Rendered inside the toolbar rail's control group / above the pill — see Task 13. */
  analysisButtons?: ReactNode;
  analysisPanel?: ReactNode;
}

/**
 * Passive view — issues nothing itself, only reports the button that was pressed via
 * props. `MapToolbar` (default export below) is the container that turns those
 * callbacks into typed `MapCommand`s.
 */
export function MapToolbarView({
  flyoutOpen,
  stopIndex,
  onStopChange,
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
  analysisButtons,
  analysisPanel,
}: MapToolbarViewProps) {
  const isMinZoom = zoom <= MIN_ZOOM + 0.05;
  const isMaxZoom = zoom >= MAX_ZOOM - 0.05;

  return (
    <div className={`map-toolbar${flyoutOpen ? ' flyout-open' : ''}`}>
      {measureValue && <div className="measure-result glass-panel">{measureValue}</div>}

      {analysisPanel}

      <div className="glass-panel toolbar-rail">
        <div className="control-group">
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

        {analysisButtons && (
          <>
            <div className="control-divider" />
            {analysisButtons}
          </>
        )}

        <div className="control-divider" />

        <div className="control-group zoom-group">
          <button
            className={`control-btn ${isMinZoom ? 'disabled' : ''}`}
            onClick={onZoomOut}
            disabled={isMinZoom}
            title="Thu nhỏ"
          >
            <ZoomOut size={18} />
          </button>
          {/* Left is zoomed out (index 0 = 1:7.500.000), right is zoomed in. */}
          <input
            type="range"
            className="zoom-slider"
            min={0}
            max={ZOOM_STOPS.length - 1}
            step={1}
            value={stopIndex}
            onChange={(e) => onStopChange(Number(e.currentTarget.value))}
            aria-label="Mức thu phóng"
            title="Mức thu phóng"
          />
          <button
            className={`control-btn ${isMaxZoom ? 'disabled' : ''}`}
            onClick={onZoomIn}
            disabled={isMaxZoom}
            title="Phóng to"
          >
            <ZoomIn size={18} />
          </button>
          <span className="zoom-scale-label">{scaleText}</span>
        </div>

        <div className="control-divider" />

        <button className="control-btn" onClick={onReset} title="Về vùng công tác">
          <Home size={18} />
        </button>

        <div className="control-divider" />

        <div className="control-group">
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
export default function MapToolbar({
  flyoutOpen,
  analysisButtons,
  analysisPanel,
}: {
  flyoutOpen: boolean;
  analysisButtons?: ReactNode;
  analysisPanel?: ReactNode;
}) {
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
        layerExists: (id) => layersState.some((l) => l.id === id),
      }),
    [map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState],
  );

  // Nấc gần nhất với mức zoom hiện tại — dùng chung cho cả hai nút và thanh trượt,
  // định nghĩa ở zoomScale.ts để kiểm thử được mà không cần bản đồ.
  const stopIndex = nearestStopIndex(zoom);

  const stepZoom = (direction: 1 | -1) => {
    const currentStop = ZOOM_STOPS[stopIndex];
    const alreadyMoving = direction === 1 ? currentStop > zoom + 0.05 : currentStop < zoom - 0.05;
    const targetIndex = alreadyMoving ? stopIndex : stopIndex + direction;
    const clamped = Math.min(ZOOM_STOPS.length - 1, Math.max(0, targetIndex));
    // Clamping to the view's actual min/max happens inside the executor
    // (features/map/model/mapCommands.ts) — this only picks the target scale stop.
    run({ kind: 'zoomTo', zoom: ZOOM_STOPS[clamped] });
  };

  const onStopChange = (index: number) => run({ kind: 'zoomTo', zoom: ZOOM_STOPS[index] });

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
      flyoutOpen={flyoutOpen}
      stopIndex={stopIndex}
      onStopChange={onStopChange}
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
      analysisButtons={analysisButtons}
      analysisPanel={analysisPanel}
    />
  );
}
