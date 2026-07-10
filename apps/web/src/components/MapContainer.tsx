import React, { useEffect, useRef } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import Select from 'ol/interaction/Select';
import { useMapContext } from './MapContext';
import { 
  stationsMockData,
  floodMockData,
  droughtSurveyMockData,
  saltwaterIntrusionMockData,
  floodGenerationMockData
} from '../data/mockData';
import { fromLonLat, transformExtent } from 'ol/proj';

const MapContainer: React.FC = () => {
  const mapElement = useRef<HTMLDivElement>(null);
  const { setMap, basemap, layersState, reservoirFilter } = useMapContext();
  const mapRef = useRef<Map | null>(null);
  const reservoirFilterRef = useRef(reservoirFilter);

  useEffect(() => {
    reservoirFilterRef.current = reservoirFilter;
  }, [reservoirFilter]);
  
  // Layer refs
  const basemapLayerRef = useRef<TileLayer<XYZ | OSM> | null>(null);
  const layersRef = useRef<Record<string, VectorLayer<VectorSource>>>({});

  useEffect(() => {
    if (!mapElement.current) return;

    // 1. Khởi tạo Basemap Layer (CartoDB Positron No Labels - không hiển thị ranh giới hành chính cũ)
    const initialBasemap = new TileLayer({
      className: 'basemap-tile-layer',
      source: new XYZ({
        url: 'https://{a-d}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        attributions: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 20
      }),
    });
    basemapLayerRef.current = initialBasemap;

    // Helper tạo vector layer
    const createVectorLayer = (id: string, data: any, style: any) => {
      const source = new VectorSource({
        features: new GeoJSON().readFeatures(data, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857'
        })
      });
      const layer = new VectorLayer({
        source,
        style,
        properties: { id }
      });
      layersRef.current[id] = layer;
      return layer;
    };

    // Helper tạo vector layer từ URL GeoJSON
    const createVectorLayerFromUrl = (id: string, url: string, style: any, options: any = {}) => {
      const source = new VectorSource({
        url: url,
        format: new GeoJSON()
      });
      const layer = new VectorLayer({
        source,
        style,
        properties: { id },
        ...options
      });
      layersRef.current[id] = layer;
      return layer;
    };

    // 2. Định nghĩa Style & Khởi tạo các Vector Layer theo phương pháp nền đồ giải (Cartodiagram)
    // Kích thước vòng tròn đại diện cho công suất phát điện (Wattage_PL)
    // Màu sắc đại diện cho trạng thái hoạt động (Bình thường, Xả lũ, Nguy hiểm)
    const damsStyle = (feature: any) => {
      const id = feature.get('ID') || 0;
      const wattage = feature.get('Wattage_PL') || 50;

      // Phân loại trạng thái dựa trên ID
      let status = 'Bình thường';
      let color = '#10b981'; // Xanh lá - Bình thường

      if (id % 5 === 0) {
        status = 'Nguy hiểm';
        color = '#ef4444'; // Đỏ - Nguy hiểm
      } else if (id % 3 === 0) {
        status = 'Xả lũ';
        color = '#f59e0b'; // Vàng/Cam - Xả lũ
      }

      // Lưu trạng thái vào properties để hiển thị trong DynamicPopup
      feature.set('status', status);

      // Thực hiện lọc theo bộ lọc hoạt động
      const currentFilter = reservoirFilterRef.current;
      if (currentFilter !== 'all') {
        if (currentFilter === 'binh_thuong' && status !== 'Bình thường') return;
        if (currentFilter === 'xa_lu' && status !== 'Xả lũ') return;
        if (currentFilter === 'nguy_hiem' && status !== 'Nguy hiểm') return;
      }

      // Bán kính vòng tròn tỷ lệ với công suất phát điện: từ 6px đến 18px
      const radius = Math.max(6, Math.min(18, 6 + (wattage / 180)));

      return new Style({
        image: new CircleStyle({
          radius: radius,
          fill: new Fill({ color: color }),
          stroke: new Stroke({ color: '#ffffff', width: 2 })
        })
      });
    };

    // Style cho mạng lưới sông ngòi động dựa trên cấp độ sông (Cap)
    const riversStyle = (feature: any) => {
      const cap = feature.get('Cap') || 6;
      
      // Sông cấp nhỏ thì nét nhỏ nhạt, cấp lớn thì nét dày rõ
      let mainWidth = 0.5;
      let borderWidth = 1.5;
      
      if (cap === 1) {
        mainWidth = 3.5;
        borderWidth = 7;
      } else if (cap === 2) {
        mainWidth = 2.2;
        borderWidth = 5;
      } else if (cap === 3) {
        mainWidth = 1.2;
        borderWidth = 3;
      } else {
        mainWidth = 0.5;
        borderWidth = 1.5;
      }
      
      return [
        new Style({
          stroke: new Stroke({ color: '#1e3a8a', width: borderWidth }) // Viền sông xanh đậm
        }),
        new Style({
          stroke: new Stroke({ color: '#38bdf8', width: mainWidth }) // Lõi sông xanh sáng
        })
      ];
    };

    const stationsStyle = new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({ color: '#10b981' }),
        stroke: new Stroke({ color: '#ffffff', width: 1.5 })
      })
    });

    const floodStyle = new Style({
      fill: new Fill({ color: 'rgba(239, 68, 68, 0.25)' }),
      stroke: new Stroke({ color: '#ef4444', width: 1.5 })
    });

    const droughtSurveyStyle = new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: '#b45309' }),
        stroke: new Stroke({ color: '#ffffff', width: 1.5 })
      })
    });

    const saltwaterIntrusionStyle = new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: '#7c3aed' }),
        stroke: new Stroke({ color: '#ffffff', width: 1.5 })
      })
    });

    const floodGenerationStyle = new Style({
      fill: new Fill({ color: 'rgba(79, 70, 229, 0.2)' }),
      stroke: new Stroke({ color: '#4f46e5', width: 1.5 })
    });

    const damsLayer = createVectorLayerFromUrl('layer_dams', './thuydienvietnam.geojson', damsStyle);
    const riversLayer = createVectorLayerFromUrl('layer_rivers', './thuyhe.geojson', riversStyle);
    const stationsLayer = createVectorLayer('layer_stations', stationsMockData, stationsStyle);
    const floodLayer = createVectorLayer('layer_flood', floodMockData, floodStyle);
    const droughtSurveyLayer = createVectorLayer('layer_drought_survey', droughtSurveyMockData, droughtSurveyStyle);
    const saltwaterIntrusionLayer = createVectorLayer('layer_saltwater_intrusion', saltwaterIntrusionMockData, saltwaterIntrusionStyle);
    const floodGenerationLayer = createVectorLayer('layer_flood_generation', floodGenerationMockData, floodGenerationStyle);

    // Bảng màu pastel cho 34 tỉnh thành 2026
    const provinceColors = [
      'rgba(239, 246, 255, 0.55)', // blue-50
      'rgba(254, 242, 242, 0.55)', // red-50
      'rgba(236, 253, 245, 0.55)', // emerald-50
      'rgba(255, 251, 235, 0.55)', // amber-50
      'rgba(245, 243, 255, 0.55)', // violet-50
      'rgba(255, 241, 242, 0.55)', // rose-50
      'rgba(240, 253, 250, 0.55)', // teal-50
      'rgba(254, 252, 232, 0.55)', // yellow-50
      'rgba(238, 242, 255, 0.55)', // indigo-50
      'rgba(255, 247, 237, 0.55)', // orange-50
      'rgba(250, 245, 255, 0.55)', // purple-50
      'rgba(240, 249, 255, 0.55)', // sky-50
      'rgba(254, 249, 195, 0.55)', // yellow-100
      'rgba(252, 231, 243, 0.55)', // pink-100
      'rgba(219, 234, 254, 0.55)', // blue-100
      'rgba(209, 250, 229, 0.55)', // emerald-100
      'rgba(254, 243, 199, 0.55)', // amber-100
      'rgba(237, 233, 254, 0.55)', // violet-100
      'rgba(204, 251, 241, 0.55)', // teal-100
      'rgba(254, 226, 226, 0.55)', // red-100
      'rgba(224, 231, 255, 0.55)', // indigo-100
      'rgba(255, 237, 213, 0.55)', // orange-100
      'rgba(243, 232, 255, 0.55)', // purple-100
      'rgba(224, 242, 254, 0.55)', // sky-100
      'rgba(253, 230, 138, 0.45)', // yellow-200
      'rgba(251, 207, 232, 0.45)', // pink-200
      'rgba(191, 219, 254, 0.45)', // blue-200
      'rgba(167, 243, 208, 0.45)', // emerald-200
      'rgba(253, 230, 138, 0.45)', // amber-200
      'rgba(221, 214, 254, 0.45)', // violet-200
      'rgba(153, 246, 228, 0.45)', // teal-200
      'rgba(254, 202, 202, 0.45)', // red-200
      'rgba(199, 210, 254, 0.45)', // indigo-200
      'rgba(254, 215, 170, 0.45)', // orange-200
    ];

    // Style cho các tỉnh thành (GADM Cấp 1)
    const provincesStyle = (feature: any) => {
      const name = feature.get('NAME_1') || '';
      const idStr = feature.get('GID_1') || '0';
      const idMatch = idStr.match(/\d+/);
      const id = idMatch ? parseInt(idMatch[0], 10) : 0;
      const colorIndex = id % provinceColors.length;

      const geom = feature.getGeometry();
      let labelGeometry = geom;
      if (geom) {
        const geomType = geom.getType();
        if (geomType === 'MultiPolygon') {
          const polygons = geom.getPolygons();
          let maxArea = -1;
          let largestPolygon = polygons[0];
          polygons.forEach((poly: any) => {
            const area = poly.getArea();
            if (area > maxArea) {
              maxArea = area;
              largestPolygon = poly;
            }
          });
          if (largestPolygon) {
            labelGeometry = largestPolygon.getInteriorPoint();
          }
        } else if (geomType === 'Polygon') {
          labelGeometry = geom.getInteriorPoint();
        }
      }

      return [
        new Style({
          fill: new Fill({ color: provinceColors[colorIndex] }),
          stroke: new Stroke({ color: '#4338ca', width: 2.5 }),
        }),
        new Style({
          geometry: labelGeometry,
          text: new Text({
            text: name,
            font: 'bold 12px Inter, system-ui, sans-serif',
            fill: new Fill({ color: '#312e81' }),
            stroke: new Stroke({ color: '#ffffff', width: 4 }),
            overflow: true,
            padding: [2, 4, 2, 4]
          })
        })
      ];
    };

    const hashCode = (str: string) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
      }
      return Math.abs(hash);
    };

    // Style cho Phường/Xã (GADM Cấp 3, chỉ hiện nét đứt, nhạt)
    const wardsStyle = (feature: any) => {
      const name = feature.get('NAME_3') || '';
      const gid3 = feature.get('GID_3') || name || '';
      const hue = Math.round((hashCode(gid3) * 137.5) % 360);
      const fillColor = `hsla(${hue}, 65%, 80%, 0.25)`;

      return new Style({
        fill: new Fill({ color: fillColor }),
        stroke: new Stroke({ color: 'rgba(107, 114, 128, 0.4)', width: 1, lineDash: [4, 4] }),
        text: new Text({
          text: name,
          font: 'normal 10.5px Inter, system-ui, sans-serif',
          fill: new Fill({ color: '#374151' }),
          stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
          overflow: false,
          padding: [1, 2, 1, 2]
        })
      });
    };

    // Tải layer ranh giới tỉnh và xã từ GeoJSON (quản lý ẩn hiện động theo mức zoom qua event listener để tránh lỗi hiển thị khi di chuyển)
    const provincesLayer = createVectorLayerFromUrl('layer_provinces_2026', './gadm41_VNM_1.geojson', provincesStyle);
    
    const wardsLayer = createVectorLayerFromUrl('layer_wards_2026', './gadm41_VNM_3.geojson', wardsStyle);

    // 3. Khởi tạo Map
    const map = new Map({
      target: mapElement.current,
      layers: [
        initialBasemap, 
        provincesLayer,
        wardsLayer,
        floodLayer,
        riversLayer,
        damsLayer,
        stationsLayer,
        droughtSurveyLayer,
        saltwaterIntrusionLayer,
        floodGenerationLayer
      ],
      view: new View({
        center: fromLonLat([108.2, 13.5]),
        zoom: 7,
        minZoom: 4.0,
        maxZoom: 20,
        extent: transformExtent([107.0, 10.5, 109.5, 16.5], 'EPSG:4326', 'EPSG:3857'),
      }),
      controls: []
    });

    // Thêm interaction để highlight sông khi click
    const selectInteraction = new Select({
      layers: [riversLayer],
      style: (feature) => {
        const cap = feature.get('Cap') || 6;
        
        let mainWidth = 0.5;
        let borderWidth = 1.5;
        
        if (cap === 1) {
          mainWidth = 3.5;
          borderWidth = 7;
        } else if (cap === 2) {
          mainWidth = 2.2;
          borderWidth = 5;
        } else if (cap === 3) {
          mainWidth = 1.2;
          borderWidth = 3;
        } else {
          mainWidth = 0.5;
          borderWidth = 1.5;
        }
        
        return [
          new Style({
            stroke: new Stroke({ color: '#fde047', width: borderWidth + 4 }) // Viền ngoài màu vàng sáng (yellow-300)
          }),
          new Style({
            stroke: new Stroke({ color: '#ef4444', width: mainWidth + 2 }) // Lõi màu đỏ (red-500)
          })
        ];
      }
    });
    map.addInteraction(selectInteraction);

    mapRef.current = map;
    setMap(map);

    return () => {
      map.removeInteraction(selectInteraction);
      map.setTarget(undefined);
    };
  }, []);

  // Lắng nghe thay đổi Basemap (Yêu cầu 1.1)
  useEffect(() => {
    if (!basemapLayerRef.current) return;
    
    let newSource;
    switch (basemap) {
      case 'satellite':
        newSource = new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maxZoom: 19
        });
        break;
      case 'dem':
        newSource = new XYZ({
          url: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
          attributions: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA',
          maxZoom: 15
        });
        break;
      case 'street':
      default:
        newSource = new XYZ({
          url: 'https://{a-d}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
          attributions: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          maxZoom: 20
        });
        break;
    }
    basemapLayerRef.current.setSource(newSource);
  }, [basemap]);

  // Lắng nghe thay đổi LayerState và zoom/pan để cập nhật hiển thị ranh giới
  useEffect(() => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    const updateLayersVisibility = () => {
      const zoom = map.getView().getZoom();
      const currentZoom = zoom !== undefined ? zoom : 7;
      
      layersState.forEach(state => {
        const layer = layersRef.current[state.id];
        if (layer) {
          let zoomVisible = true;
          // Ranh giới tỉnh chỉ hiện khi zoom <= 9.5, ranh giới xã phường hiện khi zoom > 9.5
          if (state.id === 'layer_provinces_2026') {
            zoomVisible = true; // Luôn hiển thị ranh giới tỉnh
          } else if (state.id === 'layer_wards_2026') {
            zoomVisible = currentZoom >= 10.0; // Chỉ hiện ranh giới xã khi phóng to
          }
          
          layer.setVisible(state.visible && zoomVisible);
          layer.setOpacity(state.opacity);
        }
      });
    };

    updateLayersVisibility();
    
    map.on('moveend', updateLayersVisibility);
    return () => {
      map.un('moveend', updateLayersVisibility);
    };
  }, [layersState]);

  // Lắng nghe thay đổi reservoirFilter để vẽ lại layer hồ chứa
  useEffect(() => {
    const damsLayer = layersRef.current['layer_dams'];
    if (damsLayer) {
      damsLayer.changed();
    }
  }, [reservoirFilter]);

  return (
    <div ref={mapElement} className={`map-container basemap-${basemap}`} />
  );
};

export default MapContainer;
