import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat, transformExtent } from 'ol/proj';
import {
  VIETNAM_EXTENT_4326,
  MAP_MIN_ZOOM,
  MAP_MAX_ZOOM,
  MAP_DEFAULT_CENTER_4326,
  MAP_DEFAULT_ZOOM,
} from '@webatlas/shared';
import { createWfsVectorSource } from './wfsSource';
import {
  provincesStyle,
  wardsStyle,
  riversStyle,
  stationsStyle,
  floodStyle,
  droughtSurveyStyle,
  saltwaterIntrusionStyle,
  floodGenerationStyle,
  makeDamsStyle,
} from './styles';

export type BasemapType = 'satellite' | 'street' | 'dem';
export type ReservoirFilterType = 'all' | 'binh_thuong' | 'xa_lu' | 'nguy_hiem';

export interface LayerState {
  id: string;
  visible: boolean;
  opacity: number;
}

/**
 * Owns the OpenLayers `Map` instance and all layer/interaction wiring.
 * Behaviour moved verbatim from the previous MapContainer useEffects (Plan 3b Task 3).
 */
export class MapModel {
  private map: Map | null = null;
  private basemapLayer: TileLayer<XYZ | OSM> | null = null;
  private layers: Record<string, VectorLayer<VectorSource>> = {};
  private reservoirFilter: ReservoirFilterType = 'all';
  private layerStates: LayerState[] = [];
  private moveendHandler: (() => void) | null = null;

  init(target: HTMLElement): void {
    // Idempotency guard for React 19 StrictMode double-invoked effects.
    if (this.map) return;

    // 1. Khởi tạo Basemap Layer (CartoDB Positron No Labels - không hiển thị ranh giới hành chính cũ)
    const initialBasemap = new TileLayer({
      className: 'basemap-tile-layer',
      source: new XYZ({
        url: 'https://{a-d}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        attributions: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 20
      }),
    });
    this.basemapLayer = initialBasemap;

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
      this.layers[id] = layer;
      return layer;
    };

    const damsStyle = makeDamsStyle(() => this.reservoirFilter);

    const damsLayer = new VectorLayer({ source: createWfsVectorSource('dams'), style: damsStyle, properties: { id: 'layer_dams' } });
    this.layers['layer_dams'] = damsLayer;
    const riversLayer = new VectorLayer({ source: createWfsVectorSource('rivers'), style: riversStyle, properties: { id: 'layer_rivers' } });
    this.layers['layer_rivers'] = riversLayer;
    const mkWfs = (stateId: string, key: Parameters<typeof createWfsVectorSource>[0], style: any) => {
      const layer = new VectorLayer({ source: createWfsVectorSource(key), style, properties: { id: stateId } });
      this.layers[stateId] = layer;
      return layer;
    };
    const stationsLayer = mkWfs('layer_stations', 'stations', stationsStyle);
    const floodLayer = mkWfs('layer_flood', 'flood_zones', floodStyle);
    const droughtSurveyLayer = mkWfs('layer_drought_survey', 'drought_points', droughtSurveyStyle);
    const saltwaterIntrusionLayer = mkWfs('layer_saltwater_intrusion', 'saltwater_intrusion', saltwaterIntrusionStyle);
    const floodGenerationLayer = mkWfs('layer_flood_generation', 'flood_generation', floodGenerationStyle);

    // Tải layer ranh giới tỉnh và xã từ GeoJSON (quản lý ẩn hiện động theo mức zoom qua event listener để tránh lỗi hiển thị khi di chuyển)
    const provincesLayer = createVectorLayerFromUrl('layer_provinces_2026', './gadm41_VNM_1.geojson', provincesStyle);

    const wardsLayer = createVectorLayerFromUrl('layer_wards_2026', './gadm41_VNM_3.geojson', wardsStyle);

    // 3. Khởi tạo Map
    const map = new Map({
      target,
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
        center: fromLonLat([...MAP_DEFAULT_CENTER_4326]),
        zoom: MAP_DEFAULT_ZOOM,
        minZoom: MAP_MIN_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        extent: transformExtent([...VIETNAM_EXTENT_4326], 'EPSG:4326', 'EPSG:3857'),
      }),
      controls: []
    });

    this.map = map;

    // Lắng nghe thay đổi LayerState và zoom/pan để cập nhật hiển thị ranh giới
    const updateLayersVisibility = () => this.recomputeVisibility();

    this.moveendHandler = updateLayersVisibility;
    map.on('moveend', updateLayersVisibility);
  }

  // Shared by the moveend listener (init) and applyLayerStates() so both use
  // identical zoom-visibility logic against the last-known layerStates.
  private recomputeVisibility(): void {
    if (!this.map) return;
    const zoom = this.map.getView().getZoom();
    const currentZoom = zoom !== undefined ? zoom : 7;

    this.layerStates.forEach(state => {
      const layer = this.layers[state.id];
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
  }

  getMap(): Map | null {
    return this.map;
  }

  // Lắng nghe thay đổi Basemap (Yêu cầu 1.1)
  setBasemap(type: BasemapType): void {
    if (!this.basemapLayer) return;

    let newSource;
    switch (type) {
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
    this.basemapLayer.setSource(newSource);
  }

  // Lắng nghe thay đổi LayerState (lưu lại states để moveend handler ở init() tái sử dụng khi tính toán zoomVisible)
  applyLayerStates(states: LayerState[]): void {
    if (!this.map) return;
    this.layerStates = states;
    this.recomputeVisibility();
  }

  // Lắng nghe thay đổi reservoirFilter để vẽ lại layer hồ chứa
  setReservoirFilter(filter: ReservoirFilterType): void {
    this.reservoirFilter = filter;
    const damsLayer = this.layers['layer_dams'];
    if (damsLayer) {
      damsLayer.changed();
    }
  }

  /**
   * Force a WFS refetch for a thematic layer by its layersState id (e.g. 'layer_dams').
   * Called after an admin create/edit so the new feature renders live (design §4.7).
   */
  refreshLayer(layerStateId: string): void {
    if (!this.map) return;
    const layer = this.layers[layerStateId];
    if (!layer) return;
    layer.getSource()?.refresh();
  }

  /**
   * No-op now that the rivers-only Select is retired (Task 6 of the selection-panel plan);
   * kept so `MapView`'s `registerSetSelectActive` wiring stays compilable until that wiring
   * itself is retired. There is no interaction left to enable/disable.
   */
  setSelectActive(_active: boolean): void {}

  dispose(): void {
    if (!this.map) return;

    if (this.moveendHandler) {
      this.map.un('moveend', this.moveendHandler);
      this.moveendHandler = null;
    }
    this.map.setTarget(undefined);
    this.map = null;
    this.basemapLayer = null;
    this.layers = {};
  }
}
