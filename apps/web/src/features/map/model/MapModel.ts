import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Select from 'ol/interaction/Select';
import { fromLonLat, transformExtent } from 'ol/proj';
import { createWfsVectorSource } from './wfsSource';
import { MIN_ZOOM, MAX_ZOOM, VIETNAM_EXTENT_4326, INITIAL_CENTER_4326, INITIAL_ZOOM } from './zoomScale';
import {
  createBboxLoadGate,
  createOneShotLoadGate,
  createPendingRefreshQueue,
  WATER_MIN_ZOOM,
  WARDS_MIN_ZOOM,
} from './zoomLoadGate';
import {
  provincesStyle,
  wardsStyle,
  riversStyle,
  lakesStyle,
  stationsStyle,
  floodStyle,
  droughtSurveyStyle,
  saltwaterIntrusionStyle,
  floodGenerationStyle,
  makeDamsStyle,
  makeRiverSelectStyle,
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
  private selectInteraction: Select | null = null;
  private reservoirFilter: ReservoirFilterType = 'all';
  private layerStates: LayerState[] = [];
  private moveendHandler: (() => void) | null = null;
  /** Cổng tải sông/hồ theo zoom — chạy mỗi lần moveend (xem zoomLoadGate.ts). */
  private waterGate: ((zoom: number) => void) | null = null;
  /** Cổng tải ranh giới xã — chỉ nạp một lần khi vượt zoom 10. */
  private wardsGate: ((zoom: number) => void) | null = null;
  /**
   * Lớp đã bị cổng zoom gỡ source nhưng có yêu cầu refresh trong lúc đó.
   *
   * Vì sao cần: sông và hồ đều là lớp CHO PHÉP SỬA. Nếu quản trị viên vẽ/sửa ở
   * mức zoom dưới ngưỡng, API ghi thành công nhưng refreshLayer() gọi vào source
   * null nên im lặng không làm gì — đối tượng vừa lưu KHÔNG hiện ra, y hệt như
   * lưu thất bại. Ghi nhận lại ở đây để nạp bù đúng lúc gắn source trở lại.
   */
  private pendingRefresh = createPendingRefreshQueue();

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
    const lakesLayer = mkWfs('layer_lakes', 'lakes', lakesStyle);

    // Cổng tải sông/hồ theo zoom. Gỡ hẳn source khỏi layer khi ở dưới ngưỡng —
    // layer không có source thì không tải gì cả, và đây là API công khai của
    // OpenLayers (Layer#setSource) nên không phải lách nội bộ thư viện.
    //
    // Vì sao cần: khung nhìn lúc mở (zoom 7) trải 101–116°Đ nên bbox vẫn kéo về
    // trọn 17,6 MB dữ liệu sông. Chỉ từ zoom 8,5 bbox mới thực sự cắt bớt.
    const riversSource = riversLayer.getSource();
    const lakesSource = lakesLayer.getSource();
    this.waterGate = createBboxLoadGate(
      WATER_MIN_ZOOM,
      () => {
        riversLayer.setSource(riversSource);
        lakesLayer.setSource(lakesSource);
        // Nạp bù cho yêu cầu refresh đã rơi vào lúc source bị gỡ (xem pendingRefresh).
        for (const id of ['layer_rivers', 'layer_lakes']) {
          if (this.pendingRefresh.take(id)) this.layers[id]?.getSource()?.refresh();
        }
      },
      () => {
        riversLayer.setSource(null);
        lakesLayer.setSource(null);
        // PHẢI dùng refresh() chứ không phải clear(): clear() chỉ xoá feature mà
        // GIỮ NGUYÊN loadedExtentsRtree_, nên khi gắn source lại OpenLayers tưởng
        // các extent đã tải xong và sẽ không gửi request nào (ol/source/Vector.js:566
        // so với refresh() ở dòng 1058 — refresh xoá cả hai).
        riversSource?.refresh();
        lakesSource?.refresh();
      }
    );
    const stationsLayer = mkWfs('layer_stations', 'stations', stationsStyle);
    const floodLayer = mkWfs('layer_flood', 'flood_zones', floodStyle);
    const droughtSurveyLayer = mkWfs('layer_drought_survey', 'drought_points', droughtSurveyStyle);
    const saltwaterIntrusionLayer = mkWfs('layer_saltwater_intrusion', 'saltwater_intrusion', saltwaterIntrusionStyle);
    const floodGenerationLayer = mkWfs('layer_flood_generation', 'flood_generation', floodGenerationStyle);

    // Tải layer ranh giới tỉnh và xã từ GeoJSON (quản lý ẩn hiện động theo mức zoom qua event listener để tránh lỗi hiển thị khi di chuyển)
    // Ranh giới sau sáp nhập (01/7/2025): 34 tỉnh cả nước; xã chỉ có trong vùng
    // công tác — zoom ra ngoài vùng sẽ thấy ranh giới tỉnh nhưng không có xã.
    const provincesLayer = createVectorLayerFromUrl('layer_provinces_2026', './provinces-34.geojson', provincesStyle);

    // Source ranh giới xã khởi tạo RỖNG: file ~6,9 MB mà chỉ hiển thị từ zoom 10.
    // setMinZoom của OpenLayers chỉ chặn VẼ chứ không chặn TẢI, nên phải chặn ở
    // tầng source: chỉ nạp URL vào lần đầu người dùng vượt ngưỡng (xem zoomLoadGate.ts).
    // `format` bắt buộc phải có ngay từ đầu vì setUrl() có assert yêu cầu
    // (ol/source/Vector.js:1192).
    const wardsSource = new VectorSource({ format: new GeoJSON() });
    const wardsLayer = new VectorLayer({
      source: wardsSource,
      style: wardsStyle,
      properties: { id: 'layer_wards_2026' },
    });
    this.layers['layer_wards_2026'] = wardsLayer;
    this.wardsGate = createOneShotLoadGate(WARDS_MIN_ZOOM, () => {
      wardsSource.setUrl('./wards-region.geojson');
      wardsSource.refresh();
    });

    // 3. Khởi tạo Map
    const map = new Map({
      target,
      layers: [
        initialBasemap,
        provincesLayer,
        wardsLayer,
        floodLayer,
        lakesLayer,
        riversLayer,
        damsLayer,
        stationsLayer,
        droughtSurveyLayer,
        saltwaterIntrusionLayer,
        floodGenerationLayer
      ],
      view: new View({
        // Mở ứng dụng ngay tại VÙNG CÔNG TÁC, không phải toàn quốc: dữ liệu chuyên
        // đề chỉ có trong vùng này, và khung nhìn toàn quốc buộc chiến lược bbox
        // phải tải sạch dữ liệu ngay từ đầu. Xem INITIAL_CENTER_4326 trong zoomScale.
        // Người dùng vẫn thu nhỏ được tới MIN_ZOOM để xem cả nước.
        center: fromLonLat(INITIAL_CENTER_4326),
        zoom: INITIAL_ZOOM,
        // Giới hạn zoom theo tỷ lệ bản đồ (Web Mercator, 96 DPI, vĩ độ ~16°N):
        // MIN_ZOOM ~ 1:7.500.000 (thu nhỏ vừa đủ thấy hết Việt Nam),
        // MAX_ZOOM ~ 1:100.000. Xem ZOOM_SCALE_LEVELS trong MapControls.
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        extent: transformExtent(VIETNAM_EXTENT_4326, 'EPSG:4326', 'EPSG:3857'),
        // Việt Nam hẹp ngang (~431px ở MIN_ZOOM) nên nếu ràng buộc cả khung nhìn,
        // OpenLayers sẽ chặn thu nhỏ lại để khung vừa extent -> kẹt ở ~1:1.750.000.
        // Chỉ ràng buộc TÂM: rìa bản đồ được phép tràn ra ngoài extent.
        constrainOnlyCenter: true,
      }),
      controls: []
    });

    // Thêm interaction để highlight sông khi click
    const selectInteraction = new Select({
      layers: [riversLayer],
      style: makeRiverSelectStyle()
    });
    map.addInteraction(selectInteraction);
    this.selectInteraction = selectInteraction;

    this.map = map;

    // Lắng nghe thay đổi LayerState và zoom/pan để cập nhật hiển thị ranh giới
    const updateLayersVisibility = () => {
      const zoom = map.getView().getZoom();
      if (zoom !== undefined) {
        this.waterGate?.(zoom);
        this.wardsGate?.(zoom);
      }
      this.recomputeVisibility();
    };

    this.moveendHandler = updateLayersVisibility;
    map.on('moveend', updateLayersVisibility);

    // Chạy cổng ngay lúc khởi tạo cho chắc. ('moveend' CÓ bắn ở lần render đầu tiên
    // — ol/Map.js nhánh idle — nên đây là lớp bảo hiểm, không phải bắt buộc: lần
    // moveend sau đó cùng mức zoom sẽ tự early-return vì trạng thái không đổi.)
    this.waterGate?.(INITIAL_ZOOM);

    // Chỉ để script đo hiệu năng (apps/web/scripts/profile-map.mjs) truy cập được map.
    // Dev-only: production build không đặt biến này.
    if (import.meta.env.DEV) {
      (window as unknown as { __olMap?: Map }).__olMap = map;
    }
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
          // Cùng ngưỡng với cổng TẢI ở zoomLoadGate.ts — một nguồn sự thật duy nhất.
          zoomVisible = currentZoom >= WARDS_MIN_ZOOM; // Chỉ hiện ranh giới xã khi phóng to
        } else if (state.id === 'layer_rivers' || state.id === 'layer_lakes') {
          // Khớp ngưỡng VẼ với ngưỡng TẢI: dưới 8,5 source bị gỡ nên lớp rỗng.
          // Nếu vẫn để "hiện", chú giải sẽ liệt kê sông/hồ (kèm ghi công ODbL) cho
          // những lớp đang không vẽ gì — người dùng tưởng bản đồ hỏng.
          zoomVisible = currentZoom >= WATER_MIN_ZOOM;
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
    const source = layer.getSource();
    if (!source) {
      // Source đang bị cổng zoom gỡ ra: refresh() sẽ rơi vào hư không và đối tượng
      // vừa lưu sẽ không bao giờ hiện. Ghi nhận để nạp bù khi cổng mở lại.
      this.pendingRefresh.add(layerStateId);
      return;
    }
    source.refresh();
  }

  /** Enable/disable the rivers click-highlight Select (disabled during admin edit mode so it doesn't fire alongside the edit selection). */
  setSelectActive(active: boolean): void {
    this.selectInteraction?.setActive(active);
  }

  dispose(): void {
    if (!this.map) return;

    if (this.selectInteraction) {
      this.map.removeInteraction(this.selectInteraction);
      this.selectInteraction = null;
    }
    if (this.moveendHandler) {
      this.map.un('moveend', this.moveendHandler);
      this.moveendHandler = null;
    }
    this.waterGate = null;
    this.wardsGate = null;
    this.pendingRefresh.clear();
    this.map.setTarget(undefined);
    this.map = null;
    this.basemapLayer = null;
    this.layers = {};
  }
}
