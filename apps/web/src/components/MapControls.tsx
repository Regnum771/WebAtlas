import React, { useState, useEffect } from 'react';
import { useMapContext } from '../app/providers/MapProvider';
import { ZoomIn, ZoomOut, Home, Ruler, Square, MousePointer2 } from 'lucide-react';
import { fromLonLat } from 'ol/proj';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_SCALE_LEVELS,
  VIETNAM_CENTER_4326,
  zoomForScale,
  scaleAtZoom,
  formatScale,
} from '../features/map/model/zoomScale';
import Draw from 'ol/interaction/Draw';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { getLength, getArea } from 'ol/sphere';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';

const MapControls: React.FC = () => {
  const { map } = useMapContext();
  const [activeTool, setActiveTool] = useState<'pan' | 'length' | 'area'>('pan');
  const [measureValue, setMeasureValue] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(MIN_ZOOM);
  const [minZoom, setMinZoom] = useState<number>(MIN_ZOOM);
  const [maxZoom, setMaxZoom] = useState<number>(MAX_ZOOM);

  useEffect(() => {
    if (!map) return;

    const view = map.getView();
    setCurrentZoom(view.getZoom() ?? MIN_ZOOM);
    setMinZoom(view.getMinZoom() ?? MIN_ZOOM);
    setMaxZoom(view.getMaxZoom() ?? MAX_ZOOM);

    // `change:resolution` bắn liên tục trong lúc zoom, nên slider bám sát thao tác
    // (kể cả cuộn chuột) thay vì chỉ nhảy một lần khi kết thúc như `moveend`.
    const handleResolutionChange = () => {
      const zoom = view.getZoom();
      if (zoom !== undefined) {
        setCurrentZoom(zoom);
      }
    };

    view.on('change:resolution', handleResolutionChange);
    return () => {
      view.un('change:resolution', handleResolutionChange);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;

    // Layer lưu kết quả đo
    const source = new VectorSource();
    const vector = new VectorLayer({
      source: source,
      style: {
        'fill-color': 'rgba(255, 255, 255, 0.2)',
        'stroke-color': '#ffcc33',
        'stroke-width': 2,
        'circle-radius': 7,
        'circle-fill-color': '#ffcc33',
      },
      zIndex: 999
    });
    map.addLayer(vector);

    let draw: Draw | null = null;

    if (activeTool !== 'pan') {
      const type = activeTool === 'length' ? 'LineString' : 'Polygon';
      draw = new Draw({
        source: source,
        type: type,
      });

      draw.on('drawstart', () => {
        source.clear();
        setMeasureValue(null);
      });

      draw.on('drawend', (e) => {
        const geom = e.feature.getGeometry();
        if (!geom) return;

        if (geom instanceof LineString) {
          const length = getLength(geom);
          const output = length > 100 ? (Math.round((length / 1000) * 100) / 100) + ' km' : (Math.round(length * 100) / 100) + ' m';
          setMeasureValue(`Chiều dài: ${output}`);
        } else if (geom instanceof Polygon) {
          const area = getArea(geom);
          const output = area > 10000 ? (Math.round((area / 1000000) * 100) / 100) + ' km²' : (Math.round(area * 100) / 100) + ' m²';
          setMeasureValue(`Diện tích: ${output}`);
        }
      });

      map.addInteraction(draw);
    }

    return () => {
      map.removeLayer(vector);
      if (draw) {
        map.removeInteraction(draw);
      }
    };
  }, [map, activeTool]);

  const isMinZoom = currentZoom <= minZoom + 0.05;
  const isMaxZoom = currentZoom >= maxZoom - 0.05;

  // Các nấc tỷ lệ quy về zoom, tăng dần — slider chạy theo chỉ số nấc chứ không
  // theo zoom thô, để mỗi bước dừng đúng ở một tỷ lệ tròn số.
  const zoomStops = React.useMemo(
    () => ZOOM_SCALE_LEVELS.map((scale) => zoomForScale(scale)).sort((a, b) => a - b),
    [],
  );

  /** Nấc gần nhất với mức zoom hiện tại (để đặt vị trí núm slider). */
  const nearestStopIndex = React.useMemo(() => {
    let best = 0;
    for (let i = 1; i < zoomStops.length; i++) {
      if (Math.abs(zoomStops[i] - currentZoom) < Math.abs(zoomStops[best] - currentZoom)) {
        best = i;
      }
    }
    return best;
  }, [zoomStops, currentZoom]);

  const animateToZoom = (zoom: number) => {
    if (!map) return;
    map.getView().animate({ zoom: Math.min(maxZoom, Math.max(minZoom, zoom)), duration: 250 });
  };

  /** Nhảy tới nấc kế tiếp theo hướng chỉ định; nếu đang ở giữa hai nấc thì bám nấc gần nhất. */
  const stepZoom = (direction: 1 | -1) => {
    const currentStop = zoomStops[nearestStopIndex];
    // Nếu zoom hiện tại đã lệch khỏi nấc theo đúng hướng đang đi, nấc gần nhất
    // chính là đích; ngược lại mới cần bước sang nấc kế.
    const alreadyMoving = direction === 1 ? currentStop > currentZoom + 0.05 : currentStop < currentZoom - 0.05;
    const targetIndex = alreadyMoving ? nearestStopIndex : nearestStopIndex + direction;
    const clamped = Math.min(zoomStops.length - 1, Math.max(0, targetIndex));
    animateToZoom(zoomStops[clamped]);
  };

  const handleZoomIn = () => stepZoom(1);
  const handleZoomOut = () => stepZoom(-1);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    animateToZoom(zoomStops[Number(e.target.value)]);
  };

  const handleHome = () =>
    map?.getView().animate({ center: fromLonLat(VIETNAM_CENTER_4326), zoom: MIN_ZOOM, duration: 500 });

  const currentScaleLabel = formatScale(scaleAtZoom(currentZoom));

  return (
    <div className="map-controls">
      {measureValue && (
        <div className="measure-result glass-panel">
          {measureValue}
        </div>
      )}

      <div className="glass-panel control-bar">
        <div className="control-group">
          <button
            className={`control-btn ${activeTool === 'pan' ? 'active' : ''}`}
            onClick={() => { setActiveTool('pan'); setMeasureValue(null); }}
            title="Di chuyển bản đồ"
          >
            <MousePointer2 size={18} />
          </button>
          <button
            className={`control-btn ${activeTool === 'length' ? 'active' : ''}`}
            onClick={() => { setActiveTool('length'); setMeasureValue(null); }}
            title="Đo chiều dài (sông)"
          >
            <Ruler size={18} />
          </button>
          <button
            className={`control-btn ${activeTool === 'area' ? 'active' : ''}`}
            onClick={() => { setActiveTool('area'); setMeasureValue(null); }}
            title="Đo diện tích (ngập)"
          >
            <Square size={18} />
          </button>
        </div>

        <div className="control-divider" />

        <div className="control-group zoom-slider-group">
          <button
            className={`control-btn ${isMinZoom ? 'disabled' : ''}`}
            onClick={handleZoomOut}
            disabled={isMinZoom}
            title="Thu nhỏ"
          >
            <ZoomOut size={18} />
          </button>

          <div className="zoom-slider-wrap">
            <input
              type="range"
              className="zoom-slider"
              min={0}
              max={zoomStops.length - 1}
              step={1}
              value={nearestStopIndex}
              onChange={handleSliderChange}
              aria-label="Mức thu phóng"
              aria-valuetext={currentScaleLabel}
              list="zoom-scale-ticks"
              title={`Tỷ lệ ${currentScaleLabel}`}
            />
            <datalist id="zoom-scale-ticks">
              {ZOOM_SCALE_LEVELS.map((scale) => (
                <option key={scale} value={ZOOM_SCALE_LEVELS.indexOf(scale)} />
              ))}
            </datalist>
            <span className="zoom-scale-label">{currentScaleLabel}</span>
          </div>

          <button
            className={`control-btn ${isMaxZoom ? 'disabled' : ''}`}
            onClick={handleZoomIn}
            disabled={isMaxZoom}
            title="Phóng to"
          >
            <ZoomIn size={18} />
          </button>
        </div>

        <div className="control-divider" />

        <button className="control-btn" onClick={handleHome} title="Toàn cảnh Việt Nam">
          <Home size={18} />
        </button>
      </div>
    </div>
  );
};

export default MapControls;
