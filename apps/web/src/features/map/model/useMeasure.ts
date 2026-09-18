import { useEffect, useState } from 'react';
import { useMapContext } from '../../../app/providers/MapProvider';
import Draw from 'ol/interaction/Draw';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { getLength, getArea } from 'ol/sphere';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { olGeometryTo4326GeoJSON } from './geo';
import { setLastShape } from './lastShape';
import type { GeoJsonGeometry } from '@webatlas/shared';

export type MeasureMode = 'none' | 'length' | 'area';

export interface UseMeasureResult {
  mode: MeasureMode;
  value: string | null;
  start: (mode: 'length' | 'area') => void;
  clear: () => void;
}

/**
 * Đo chiều dài/diện tích trên bản đồ. Chuyển nguyên trạng từ `components/MapControls.tsx`
 * (Draw interaction + getLength/getArea + định dạng kết quả) — hành vi không đổi, chỉ đổi
 * chỗ ở để cách ly import `ol` vào `features/map/model`.
 */
export function useMeasure(): UseMeasureResult {
  const { map } = useMapContext();
  const [mode, setMode] = useState<MeasureMode>('none');
  const [value, setValue] = useState<string | null>(null);

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
      zIndex: 999,
    });
    map.addLayer(vector);

    let draw: Draw | null = null;

    if (mode !== 'none') {
      const type = mode === 'length' ? 'LineString' : 'Polygon';
      draw = new Draw({
        source: source,
        type: type,
      });

      draw.on('drawstart', () => {
        source.clear();
        setValue(null);
      });

      draw.on('drawend', (e) => {
        const geom = e.feature.getGeometry();
        if (!geom) return;
        setLastShape(olGeometryTo4326GeoJSON(geom) as unknown as GeoJsonGeometry);

        if (geom instanceof LineString) {
          const length = getLength(geom);
          const output = length > 100 ? (Math.round((length / 1000) * 100) / 100) + ' km' : (Math.round(length * 100) / 100) + ' m';
          setValue(`Chiều dài: ${output}`);
        } else if (geom instanceof Polygon) {
          const area = getArea(geom);
          const output = area > 10000 ? (Math.round((area / 1000000) * 100) / 100) + ' km²' : (Math.round(area * 100) / 100) + ' m²';
          setValue(`Diện tích: ${output}`);
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
  }, [map, mode]);

  const start = (nextMode: 'length' | 'area') => {
    setMode(nextMode);
    setValue(null);
  };

  const clear = () => {
    setMode('none');
    setValue(null);
  };

  return { mode, value, start, clear };
}
