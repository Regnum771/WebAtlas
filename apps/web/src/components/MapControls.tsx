import React, { useState, useEffect } from 'react';
import { useMapContext } from '../app/providers/MapProvider';
import { ZoomIn, ZoomOut, Home, Ruler, Square, MousePointer2 } from 'lucide-react';
import { fromLonLat } from 'ol/proj';
import { MAP_MIN_ZOOM, MAP_MAX_ZOOM, MAP_DEFAULT_CENTER_4326, MAP_DEFAULT_ZOOM } from '@webatlas/shared';
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
  const [currentZoom, setCurrentZoom] = useState<number>(MAP_DEFAULT_ZOOM);
  const [minZoom, setMinZoom] = useState<number>(MAP_MIN_ZOOM);
  const [maxZoom, setMaxZoom] = useState<number>(MAP_MAX_ZOOM);

  useEffect(() => {
    if (!map) return;

    const view = map.getView();
    setCurrentZoom(view.getZoom() || MAP_DEFAULT_ZOOM);
    setMinZoom(view.getMinZoom() || MAP_MIN_ZOOM);
    setMaxZoom(view.getMaxZoom() || MAP_MAX_ZOOM);

    const handleMoveEnd = () => {
      const zoom = view.getZoom();
      if (zoom !== undefined) {
        setCurrentZoom(zoom);
      }
    };

    map.on('moveend', handleMoveEnd);
    return () => {
      map.un('moveend', handleMoveEnd);
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

  const handleZoomIn = () => {
    if (!map) return;
    const view = map.getView();
    const current = view.getZoom() || 0;
    if (current < maxZoom) {
      view.animate({ zoom: Math.min(maxZoom, current + 1), duration: 250 });
    }
  };

  const handleZoomOut = () => {
    if (!map) return;
    const view = map.getView();
    const current = view.getZoom() || 0;
    if (current > minZoom) {
      view.animate({ zoom: Math.max(minZoom, current - 1), duration: 250 });
    }
  };

  const handleHome = () => map?.getView().animate({
    center: fromLonLat([...MAP_DEFAULT_CENTER_4326]),
    zoom: MAP_DEFAULT_ZOOM,
    duration: 500,
  });

  return (
    <div className="map-controls">
      <div className="glass-panel control-group">
        <button 
          className={`control-btn ${isMaxZoom ? 'disabled' : ''}`} 
          onClick={handleZoomIn} 
          disabled={isMaxZoom}
          title="Phóng to"
        >
          <ZoomIn size={18} />
        </button>
        <button 
          className={`control-btn ${isMinZoom ? 'disabled' : ''}`} 
          onClick={handleZoomOut} 
          disabled={isMinZoom}
          title="Thu nhỏ"
        >
          <ZoomOut size={18} />
        </button>
        <button className="control-btn" onClick={handleHome} title="Toàn cảnh Nam Trung Bộ & Tây Nguyên">
          <Home size={18} />
        </button>
      </div>

      <div className="glass-panel control-group control-group-gap">
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

      {measureValue && (
        <div className="measure-result glass-panel">
          {measureValue}
        </div>
      )}
    </div>
  );
};

export default MapControls;
