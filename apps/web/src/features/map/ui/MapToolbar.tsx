import React, { useMemo, type ReactNode } from 'react';
import { Ruler, Square, MousePointer2, Map as MapIcon, Layers, Mountain } from 'lucide-react';
import type { BasemapName } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useMeasure, type MeasureMode } from '../model/useMeasure';
import { createCommandExecutor } from '../model/mapCommands';

const BASEMAP_OPTIONS: { id: BasemapName; label: string; icon: React.ReactNode }[] = [
  { id: 'street', label: 'Đường phố', icon: <MapIcon size={18} /> },
  { id: 'satellite', label: 'Vệ tinh', icon: <Layers size={18} /> },
  { id: 'dem', label: 'Địa hình', icon: <Mountain size={18} /> },
];

export interface MapToolbarViewProps {
  measureMode: MeasureMode;
  measureValue: string | null;
  activeBasemap?: BasemapName;
  onMeasure: (mode: MeasureMode) => void;
  onBasemap: (basemap: BasemapName) => void;
  /** Rendered inside the toolbar rail's control group / above the pill — see Task 13. */
  analysisButtons?: ReactNode;
  analysisPanel?: ReactNode;
  roiChip?: ReactNode;
  drawButtons?: ReactNode;
}

/**
 * Passive view — issues nothing itself, only reports the button that was pressed via
 * props. `MapToolbar` (default export below) is the container that turns those
 * callbacks into typed `MapCommand`s.
 */
export function MapToolbarView({
  measureMode,
  measureValue,
  activeBasemap,
  onMeasure,
  onBasemap,
  analysisButtons,
  analysisPanel,
  roiChip,
  drawButtons,
}: MapToolbarViewProps) {
  return (
    <div className="map-toolbar">
      {measureValue && <div className="measure-result glass-panel">{measureValue}</div>}

      {analysisPanel}

      {roiChip}

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
        </div>

        <div className="control-divider" />

        <div className="control-group" role="group" aria-label="Đo nhanh">
          <span className="control-group-label" aria-hidden="true">Đo nhanh</span>
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

        {drawButtons && (
          <>
            <div className="control-divider" />
            {drawButtons}
          </>
        )}

        {analysisButtons && (
          <>
            <div className="control-divider" />
            {analysisButtons}
          </>
        )}

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
 * Container: wires `useMeasure` (Draw interaction,
 * quarantined behind `features/map/model`), and `createCommandExecutor` — every
 * button here issues a `MapCommand` through
 * `run(...)` rather than touching `map.getView()` itself. No `ol` import here —
 * `map` arrives already typed via `useMapContext`, and is only ever handed to
 * `createCommandExecutor`, never called directly.
 */
export default function MapToolbar({
  analysisButtons,
  analysisPanel,
  roiChip,
  drawButtons,
}: {
  analysisButtons?: ReactNode;
  analysisPanel?: ReactNode;
  roiChip?: ReactNode;
  drawButtons?: ReactNode;
}) {
  const { map, basemap, setBasemap, layersState, toggleLayerVisibility, setLayerOpacity } = useMapContext();
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

  const onMeasure = (mode: MeasureMode) => {
    if (mode === 'none') {
      measure.clear();
    } else {
      measure.start(mode);
    }
  };

  const onBasemap = (b: BasemapName) => run({ kind: 'setBasemap', basemap: b });

  return (
    <MapToolbarView
      measureMode={measure.mode}
      measureValue={measure.value}
      activeBasemap={basemap}
      onMeasure={onMeasure}
      onBasemap={onBasemap}
      analysisButtons={analysisButtons}
      analysisPanel={analysisPanel}
      roiChip={roiChip}
      drawButtons={drawButtons}
    />
  );
}
