import Map from 'ol/Map';
import type MousePosition from 'ol/control/MousePosition';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import { riverOverviewVisibleAt } from './riverOverview';
import { createLoadTracker } from './loadingState';
import { createScaleBar, createMousePosition } from './mapReadouts';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type VectorTileLayer from 'ol/layer/VectorTile';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat, transformExtent } from 'ol/proj';
import { createWfsVectorSource } from './wfsSource';
import { applyWaterVersions, createWaterTileLayer, fetchWaterVersions, withHighlight, type WaterTileLayer } from './waterTiles';
import { GEOSERVER_URL } from '../../../shared/config';
import { BASEMAP_CONTEXT_LAYER_STATE_IDS, TERRAIN_LAYER_STATE_IDS, type ContourInterval } from '@webatlas/shared';
import {
  contourGwcLayer,
  contourIntervalFor,
  contourStyle,
  CONTOUR_EXTENT_4326,
  CONTOUR_ATTRIBUTION,
  type ContourSettings,
} from './contours';
import { MIN_ZOOM, MAX_ZOOM, VIETNAM_EXTENT_4326, INITIAL_CENTER_4326, INITIAL_ZOOM, settleZoomCorrection } from './zoomScale';
import { createOneShotLoadGate, WATER_MIN_ZOOM, WARDS_MIN_ZOOM } from './zoomLoadGate';
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

/**
 * Street basemap: SELF-HOSTED on GeoServer, no third-party dependency.
 *
 * It used to be CARTO `light_nolabels`. CARTO moved to a mandatory API key, and the
 * old endpoint still answers HTTP 200 with grey tiles reading "API KEY REQUIRED":
 * broken without any error. It is now rebuilt from OpenStreetMap data (Geofabrik)
 * loaded into PostGIS and rendered through the `webatlas:basemap` layer group,
 * served through GeoWebCache so tiles are cached rather than rendered every time.
 *
 * OSM data is ODbL: the "© OpenStreetMap contributors" attribution is MANDATORY.
 */
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)';

function gwcSource(layer: string, style = '', attributions: string = OSM_ATTRIBUTION): XYZ {
  // WMTS TILEROW is top-origin, matching OpenLayers' {y}. (TMS is bottom-origin —
  // mixing the two yields TileOutOfRange.) Every basemap layer group is published
  // with identical national bounds so no tile OL asks for falls out of range.
  const wmts =
    `${GEOSERVER_URL}/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
    `&LAYER=${encodeURIComponent(layer)}&STYLE=${style}&TILEMATRIXSET=EPSG:900913&FORMAT=image/png` +
    `&TILEMATRIX=EPSG:900913:{z}&TILEROW={y}&TILECOL={x}`;
  return new XYZ({
    url: wmts,
    attributions,
    maxZoom: 18,
    // GeoServer compose sets CORS_ENABLED/CORS_ALLOWED_ORIGINS "*" (verified with
    // curl -H "Origin: ..." during Task 15 Step 1) — safe to tag tiles as CORS-clean
    // so the canvas stays exportable (features/map/model/exportMap.ts).
    crossOrigin: 'anonymous',
  });
}

function streetBasemapSource(): XYZ {
  return gwcSource('webatlas:basemap');
}

/**
 * Basemap context layers, kept separate so each can be TOGGLED INDEPENDENTLY.
 *
 * Each is its own layer group on GeoServer with its OWN GWC cache: splitting them
 * keeps the caching benefit and only adds requests. Turning a layer off does not
 * release its source either: loaded tiles stay in OpenLayers' cache and show again
 * at once when it is turned back on.
 */
const [BM_ROADS, BM_RAILWAYS, BM_WATER, BM_LANDUSE] = BASEMAP_CONTEXT_LAYER_STATE_IDS;

/** Draw order, bottom to top. Ids come from the shared constant so this cannot
 *  drift from LAYER_DISPLAY or from what `isMapCommand` accepts. */
const CONTEXT_LAYERS: ReadonlyArray<{ stateId: string; gwc: string }> = [
  { stateId: BM_LANDUSE, gwc: 'webatlas:bm_landuse' },
  { stateId: BM_WATER, gwc: 'webatlas:bm_water' },
  { stateId: BM_RAILWAYS, gwc: 'webatlas:bm_railways' },
  { stateId: BM_ROADS, gwc: 'webatlas:basemap_roads' },
];

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
  /** Registry of the layers the control panel toggles. Mostly vector (WFS or, for the
   *  water layers, vector tiles), plus the contour raster (layer_contours). All of them
   *  have setVisible/setOpacity/getSource().refresh(), so the union does not break the
   *  shared call sites. */
  private layers: Record<string, VectorLayer<VectorSource> | VectorTileLayer | TileLayer<XYZ>> = {};
  /** Raster context layers (roads/rail/landuse/water). Separate registry because
   *  `layers` is typed for vector sources and its consumers call getSource().refresh(). */
  private contextLayers: Record<string, TileLayer<XYZ>> = {};
  /** The water layers drawn from API vector tiles, keyed by tile layer, for version updates. */
  private waterLayers: Partial<Record<WaterTileLayer, VectorTileLayer>> = {};
  /** The river whose `id` property is highlighted after a click (replaces ol/interaction/Select,
   *  which never selects tile features). */
  private highlightedRiverId: string | null = null;
  /** Off during admin edit mode, so the highlight does not fire alongside the edit selection. */
  private riverHighlightActive = true;
  private riverClickHandler: ((evt: MapBrowserEvent) => void) | null = null;
  /** False until a versions fetch has answered or failed, or the start-up timeout ran out; see init(). */
  private waterVersionsSettled = false;
  /** Bumped per /api/tiles/versions request: only the latest request's answer is applied. */
  private waterVersionsSeq = 0;
  private waterVersionsTimer: ReturnType<typeof setTimeout> | null = null;
  /** Coordinate readout control — kept to swap its formatter on CRS toggle. */
  private mousePosition: MousePosition | null = null;
  private reservoirFilter: ReservoirFilterType = 'all';
  private layerStates: LayerState[] = [];
  private moveendHandler: (() => void) | null = null;
  /** The far-zoom river overview layer — see riverOverview.ts. */
  private riversOverviewLayer: VectorTileLayer | null = null;
  private contourLayer: TileLayer<XYZ> | null = null;
  /** The interval on display, so the source is not reset when it need not be. */
  private contourInterval: ContourInterval | null = null;
  /** An interval the user pinned; null lets the zoom level decide. */
  private contourFixedInterval: ContourInterval | null = null;
  private contourLabels = true;
  /** Snaps to a round thousand when the view settles — see settleZoomCorrection. */
  private settleSnapHandler: (() => void) | null = null;
  /** Ward boundary load gate — loads once, the first time zoom passes 10. */
  private wardsGate: ((zoom: number) => void) | null = null;
  /** Busy/idle of basemap tile loading — see loadingState.ts. Only the raster (GWC)
   *  sources are tracked; WFS sources fire featuresloadstart/end at a different pace
   *  and would show the indicator during ordinary thematic data loads too. */
  private loadTracker = createLoadTracker((busy) => this.onLoadingChange?.(busy));
  private onLoadingChange: ((busy: boolean) => void) | null = null;
  /**
   * The tileloadstart/end/error handlers attached to each context source, kept so
   * dispose() can remove exactly them. Anonymous arrows (as before) CANNOT be un()'d:
   * they must be named and referenced, the same convention as moveendHandler/
   * settleSnapHandler above.
   *
   * Why removal is mandatory: setTarget(undefined) does not cancel tile requests in
   * flight. If MapView unmounts and mounts again (StrictMode dev double-invoke, or a
   * real remount later), the old MapModel instance still has these handlers on the
   * old sources and still has onLoadingChange pointing at React's replaced setBusy.
   * A late tileloadstart on the disposed instance would overwrite the same `busy`
   * state the new instance owns: a race.
   */
  private contextLoadHandlers: Array<{
    source: XYZ;
    type: 'tileloadstart' | 'tileloadend' | 'tileloaderror';
    handler: () => void;
  }> = [];

  /** Registers the receiver of the busy/idle state (MapView/MapProvider on the React side). */
  setLoadingListener(fn: ((busy: boolean) => void) | null): void {
    this.onLoadingChange = fn;
  }

  init(target: HTMLElement): void {
    // Idempotency guard for React 19 StrictMode double-invoked effects.
    if (this.map) return;

    // 1. The basemap layer (self-hosted, see streetBasemapSource).
    const initialBasemap = new TileLayer({
      className: 'basemap-tile-layer',
      source: streetBasemapSource(),
    });

    // Context layers: ABOVE the basemap (satellite imagery included) but BELOW the
    // thematic data. Registered in contextLayers so recomputeVisibility() drives them
    // through layersState.
    for (const { stateId, gwc } of CONTEXT_LAYERS) {
      this.contextLayers[stateId] = new TileLayer({
        className: `context-tile-${stateId}`,
        source: gwcSource(gwc),
      });
    }
    this.basemapLayer = initialBasemap;

    // Contour layer: ABOVE the basemap and context but BELOW the boundaries and
    // thematic data (see its place in the map's `layers` array below). Off by
    // default; turned on from the control panel ('Địa hình' > 'Đường đồng mức').
    //
    // extent: the contour GWC layers are published with the DATA bounds
    // (CONTOUR_EXTENT_4326), not the national bounds every other basemap layer uses —
    // see the note on that constant in contours.ts. Without the extent, every pan
    // outside the work area would request out-of-range tiles and GWC would answer
    // 400 TileOutOfRange for each one.
    const [CONTOURS] = TERRAIN_LAYER_STATE_IDS;
    const contourLayer = new TileLayer({
      source: gwcSource(contourGwcLayer(250), contourStyle(this.contourLabels), CONTOUR_ATTRIBUTION),
      visible: false,
      extent: transformExtent(CONTOUR_EXTENT_4326, 'EPSG:4326', 'EPSG:3857'),
      properties: { id: CONTOURS },
    });
    this.contourLayer = contourLayer;
    this.layers[CONTOURS] = contourLayer;

    // Track loading only for the raster tile sources (basemap + context) — see the
    // note on the loadTracker declaration above.
    for (const { stateId } of CONTEXT_LAYERS) {
      const src = this.contextLayers[stateId].getSource();
      if (!src) continue;
      const onTileLoadStart = () => this.loadTracker.start();
      const onTileLoadEnd = () => this.loadTracker.done();
      const onTileLoadError = () => this.loadTracker.done();
      src.on('tileloadstart', onTileLoadStart);
      src.on('tileloadend', onTileLoadEnd);
      src.on('tileloaderror', onTileLoadError);
      this.contextLoadHandlers.push(
        { source: src, type: 'tileloadstart', handler: onTileLoadStart },
        { source: src, type: 'tileloadend', handler: onTileLoadEnd },
        { source: src, type: 'tileloaderror', handler: onTileLoadError },
      );
    }

    // Helper: a vector layer from a GeoJSON URL.
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
    // Rivers and lakes are drawn from the API's vector tiles (waterTiles.ts). A tile
    // layer only requests the tiles in view, so these layers need no zoom load gate:
    // below WATER_MIN_ZOOM they are hidden (recomputeVisibility) and an invisible
    // layer requests nothing. The clicked river is highlighted through its style.
    const riversLayer = createWaterTileLayer(
      'rivers',
      'layer_rivers',
      withHighlight(riversStyle, makeRiverSelectStyle(), () => this.highlightedRiverId),
    );
    this.layers['layer_rivers'] = riversLayer;

    // River overview: main rivers only, with pre-simplified geometry, covering exactly
    // the part of the scale range where the full river layer is not drawn (below zoom
    // 8.5). NOT added to this.layers: that is the registry of layers the user toggles,
    // and this one follows 'layer_rivers' rather than having its own panel entry.
    const riversOverviewLayer = createWaterTileLayer('rivers_overview', 'layer_rivers_overview', riversStyle);
    this.riversOverviewLayer = riversOverviewLayer;
    const lakesLayer = createWaterTileLayer('lakes', 'layer_lakes', lakesStyle);
    this.layers['layer_lakes'] = lakesLayer;
    this.waterLayers = { rivers: riversLayer, rivers_overview: riversOverviewLayer, lakes: lakesLayer };

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

    // Province and ward boundaries from GeoJSON (shown/hidden by zoom level from the
    // moveend listener, to avoid display glitches while moving).
    // Boundaries after the merger (1 July 2025): 34 provinces nationwide; wards only
    // inside the work area — zoomed out beyond it, provinces show but wards do not.
    const provincesLayer = createVectorLayerFromUrl('layer_provinces_2026', './provinces-34.geojson', provincesStyle);

    // The ward source starts EMPTY: the file is ~6.9 MB and only shows from zoom 10.
    // OpenLayers' setMinZoom only stops DRAWING, not LOADING, so the gate sits at the
    // source: the URL is set the first time the user passes the threshold (see
    // zoomLoadGate.ts). `format` is required from the start because setUrl() asserts
    // it (ol/source/Vector.js:1192).
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

    // 3. The map.
    this.mousePosition = createMousePosition();
    const map = new Map({
      target,
      layers: [
        initialBasemap,
        // Basemap context: above the basemap, below boundaries and thematic data. The
        // order in CONTEXT_LAYERS is the draw order (land use -> water -> rail -> roads).
        ...CONTEXT_LAYERS.map(({ stateId }) => this.contextLayers[stateId]),
        contourLayer,
        provincesLayer,
        wardsLayer,
        floodLayer,
        lakesLayer,
        riversLayer,
        riversOverviewLayer,
        damsLayer,
        stationsLayer,
        droughtSurveyLayer,
        saltwaterIntrusionLayer,
        floodGenerationLayer
      ],
      view: new View({
        // Open on the WORK AREA, not the whole country: thematic data only exists
        // there, and a national view would make the bbox strategy load everything up
        // front. See INITIAL_CENTER_4326 in zoomScale. The user can still zoom out to
        // MIN_ZOOM to see the whole country.
        center: fromLonLat(INITIAL_CENTER_4326),
        zoom: INITIAL_ZOOM,
        // Zoom limits by map scale (Web Mercator, 96 DPI, latitude ~16°N):
        // MIN_ZOOM ~ 1:7,500,000 (just zoomed out enough to see all of Vietnam),
        // MAX_ZOOM ~ 1:100,000. See ZOOM_SCALE_LEVELS in MapControls.
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        extent: transformExtent(VIETNAM_EXTENT_4326, 'EPSG:4326', 'EPSG:3857'),
        // Vietnam is narrow (~431 px wide at MIN_ZOOM), so constraining the whole view
        // would stop zooming out once the view fits the extent -> stuck at ~1:1,750,000.
        // Constrain only the CENTER: the map edges may spill beyond the extent.
        constrainOnlyCenter: true,
      }),
      // An EXPLICIT list, not defaults(): defaults() brings a zoom button and an
      // attribution box that overlap our own toolbar and bottom-right corner.
      controls: [createScaleBar(), this.mousePosition],
    });

    // Highlight the clicked river. ol/interaction/Select does not select tile features,
    // so the click sets the highlighted id and the rivers style draws it (withHighlight).
    const onRiverClick = (evt: MapBrowserEvent) => {
      if (!this.riverHighlightActive) return;
      let id: string | null = null;
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          const value = feature.get('id');
          id = typeof value === 'string' ? value : null;
          return true;
        },
        { layerFilter: (l) => l === riversLayer },
      );
      this.setRiverHighlight(id);
    };
    this.riverClickHandler = onRiverClick;
    map.on('singleclick', onRiverClick);

    this.map = map;

    // Follow LayerState changes and zoom/pan to update what is shown.
    const updateLayersVisibility = () => {
      const zoom = map.getView().getZoom();
      if (zoom !== undefined) {
        this.wardsGate?.(zoom);
        // Swap the source only when the contour interval really changes: a new source
        // throws away every loaded tile, so doing it on every map move would flicker.
        // contourFixedInterval, pinned by the user (setContourSettings, Task 6), wins
        // over the automatic per-zoom interval: when it is not null, `wanted` always
        // equals that fixed value whatever the zoom, so it matches contourInterval from
        // the first call and the branch below never resets the source on zoom changes.
        const wanted = this.contourFixedInterval ?? contourIntervalFor(zoom);
        if (this.contourLayer && wanted !== this.contourInterval) {
          this.contourInterval = wanted;
          this.contourLayer.setSource(
            gwcSource(contourGwcLayer(wanted), contourStyle(this.contourLabels), CONTOUR_ATTRIBUTION),
          );
        }
      }
      this.recomputeVisibility();
    };

    this.moveendHandler = updateLayersVisibility;
    map.on('moveend', updateLayersVisibility);

    // Free zoom (wheel, pinch, double-click, keyboard) stays continuous while
    // the user is acting; when the view settles we round the scale denominator
    // to a clean thousand. moveend is the one hook that covers every zoom path,
    // including programmatic animations, rather than special-casing the wheel.
    //
    // No animate(): the correction is at most 500 in the denominator, invisible
    // on screen, and animating it would both read as a twitch and stretch the
    // window in which the loop guard has to hold.
    const settleSnap = () => {
      const view = map.getView();
      const zoom = view.getZoom();
      if (zoom === undefined) return;
      const corrected = settleZoomCorrection(zoom);
      // null means already settled. That is the loop guard: setting the zoom
      // below fires another moveend, and this branch makes that second pass a
      // no-op instead of an endless correction cycle.
      if (corrected === null) return;
      view.setZoom(corrected);
    };
    this.settleSnapHandler = settleSnap;
    map.on('moveend', settleSnap);

    // Point the water layers at their active versions, so their tiles are cacheable for
    // good. A failed fetch leaves the unversioned URLs, which still work, uncached. The
    // water layers stay hidden until then (waterVersionsSettled): drawn earlier, the
    // overview would load every tile in view twice, unversioned and then versioned. A
    // request that hangs must not hide them for good, hence the timeout.
    this.waterVersionsTimer = setTimeout(() => this.settleWaterVersions(), MapModel.WATER_VERSIONS_TIMEOUT_MS);
    this.syncWaterVersions(() => {});

    // Only so the profiling script (apps/web/scripts/profile-map.mjs) can reach the map.
    // Dev-only: the production build does not set it.
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
        if (state.id === 'layer_provinces_2026') {
          zoomVisible = true; // Province boundaries always show.
        } else if (state.id === 'layer_wards_2026') {
          // Same threshold as the LOAD gate in zoomLoadGate.ts — a single source of truth.
          zoomVisible = currentZoom >= WARDS_MIN_ZOOM; // Ward boundaries only when zoomed in.
        } else if (state.id === 'layer_rivers' || state.id === 'layer_lakes') {
          // Below 8.5 the full water layers do not draw (the river overview stands in
          // for rivers), and a hidden tile layer requests nothing. The legend reads this
          // visibility, so it does not list (with their ODbL credit) layers drawing nothing.
          zoomVisible = this.waterVersionsSettled && currentZoom >= WATER_MIN_ZOOM;
        }

        layer.setVisible(state.visible && zoomVisible);
        layer.setOpacity(state.opacity);
      }

      // Raster context layers: no zoom gate of their own — detail is already driven by
      // scale denominators in the GeoServer SLDs, so they only follow layersState.
      const context = this.contextLayers[state.id];
      if (context) {
        context.setVisible(state.visible);
        context.setOpacity(state.opacity);
      }
    });

    // The overview and full river layers are alternate representations. Keep
    // their handoff in the same visibility pass so layer-state changes cannot
    // leave both representations drawing at once.
    const riversOn = this.layerStates.find((l) => l.id === 'layer_rivers')?.visible ?? true;
    this.riversOverviewLayer?.setVisible(this.waterVersionsSettled && riverOverviewVisibleAt(currentZoom) && riversOn);
  }

  getMap(): Map | null {
    return this.map;
  }

  /**
   * OpenLayers caches the viewport size at init and after each explicit
   * updateSize() call — it does not observe its container's box on its own.
   * The rail flyout inset (.map-container's left/width in main.css) resizes
   * that container without the OL canvas ever changing size itself, so the
   * canvas would keep rendering at the pre-toggle size and clip/misplace
   * content until a manual resize. Call this once the CSS transition that
   * animates the inset has finished (see MapView's transitionend listener) —
   * calling it mid-transition would read the interpolated, not final, size.
   */
  updateSize(): void {
    this.map?.updateSize();
  }

  // Basemap switch (requirement 1.1).
  setBasemap(type: BasemapType): void {
    if (!this.basemapLayer) return;

    let newSource;
    switch (type) {
      case 'satellite':
        newSource = new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maxZoom: 19,
          // Esri returns access-control-allow-origin: * (verified with curl during
          // Task 15 Step 1) — safe to tag as CORS-clean for map export.
          crossOrigin: 'anonymous',
        });
        break;
      case 'dem':
        newSource = new XYZ({
          url: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
          attributions: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA',
          maxZoom: 15,
          // Esri returns access-control-allow-origin: * (verified with curl during
          // Task 15 Step 1) — safe to tag as CORS-clean for map export.
          crossOrigin: 'anonymous',
        });
        break;
      case 'street':
      default:
        newSource = streetBasemapSource();
        break;
    }
    this.basemapLayer.setSource(newSource);
  }

  // LayerState changes (kept so the moveend handler from init() reuses them for zoomVisible).
  applyLayerStates(states: LayerState[]): void {
    if (!this.map) return;
    this.layerStates = states;
    this.recomputeVisibility();
  }

  // A reservoirFilter change redraws the dams layer.
  setReservoirFilter(filter: ReservoirFilterType): void {
    this.reservoirFilter = filter;
    const damsLayer = this.layers['layer_dams'];
    if (damsLayer) {
      damsLayer.changed();
    }
  }

  /**
   * Called by the control panel (Task 6) when the user changes the contour interval or
   * toggles labels. A fixed interval (not 'auto') wins over the automatic per-zoom one:
   * a non-null contourFixedInterval makes the branch in updateLayersVisibility()
   * (moveend) always compute `wanted` as exactly this value, so it never drifts from
   * contourInterval and the source is not reset when the zoom changes.
   */
  setContourSettings(settings: ContourSettings): void {
    this.contourLabels = settings.labels;
    this.contourFixedInterval = settings.interval === 'auto' ? null : settings.interval;
    const zoom = this.map?.getView().getZoom() ?? 0;
    const wanted = this.contourFixedInterval ?? contourIntervalFor(zoom);
    this.contourInterval = wanted;
    this.contourLayer?.setSource(
      gwcSource(contourGwcLayer(wanted), contourStyle(settings.labels), CONTOUR_ATTRIBUTION),
    );
  }

  /**
   * Force a refetch for a thematic layer by its layersState id (e.g. 'layer_dams').
   * Called after an admin create/edit so the new feature renders live (design §4.7).
   * The water layers are tiles keyed by the layer's active version: the edit just
   * committed made a new version, so pointing them at it is the refresh.
   */
  refreshLayer(layerStateId: string): void {
    if (!this.map) return;
    if (layerStateId === 'layer_rivers' || layerStateId === 'layer_lakes') {
      this.syncWaterVersions((e) => console.warn('[tiles] could not refresh the water layer versions', e));
      return;
    }
    this.layers[layerStateId]?.getSource()?.refresh();
  }

  /** How long the water layers wait for the start-up versions before showing anyway. */
  static readonly WATER_VERSIONS_TIMEOUT_MS = 5000;

  /**
   * Fetch the active water versions and point the tile layers at them. Requests can answer
   * out of order (start-up, then a refresh after an edit): only the latest one is applied,
   * so an older answer can never point a layer back at a superseded version. Any answer
   * settles the start-up wait.
   */
  private syncWaterVersions(onError: (e: unknown) => void): void {
    const map = this.map;
    const seq = ++this.waterVersionsSeq;
    fetchWaterVersions()
      .then((v) => {
        if (this.map !== map) return;
        if (seq === this.waterVersionsSeq) applyWaterVersions(this.waterLayers, v);
        this.settleWaterVersions();
      })
      .catch((e) => {
        if (this.map !== map) return;
        onError(e);
        this.settleWaterVersions();
      });
  }

  private settleWaterVersions(): void {
    if (this.waterVersionsTimer !== null) {
      clearTimeout(this.waterVersionsTimer);
      this.waterVersionsTimer = null;
    }
    if (this.waterVersionsSettled || !this.map) return;
    this.waterVersionsSettled = true;
    this.recomputeVisibility();
  }

  /** Enable/disable the rivers click highlight (disabled during admin edit mode so it doesn't fire alongside the edit selection). */
  setSelectActive(active: boolean): void {
    this.riverHighlightActive = active;
    if (!active) this.setRiverHighlight(null);
  }

  private setRiverHighlight(id: string | null): void {
    if (id === this.highlightedRiverId) return;
    this.highlightedRiverId = id;
    // The style reads the id when a tile is drawn: changed() makes the tiles redraw.
    this.waterLayers.rivers?.changed();
  }

  /** Swaps the coordinate readout's formatter (CRS toggle). The control keeps
   *  projecting to EPSG:4326; the formatter converts from there. */
  setCoordinateFormat(format: (coord?: number[]) => string): void {
    this.mousePosition?.setCoordinateFormat(format);
  }

  dispose(): void {
    if (!this.map) return;

    if (this.riverClickHandler) {
      this.map.un('singleclick', this.riverClickHandler);
      this.riverClickHandler = null;
    }
    if (this.moveendHandler) {
      this.map.un('moveend', this.moveendHandler);
      this.moveendHandler = null;
    }
    if (this.settleSnapHandler) {
      this.map.un('moveend', this.settleSnapHandler);
      this.settleSnapHandler = null;
    }
    this.wardsGate = null;
    // Remove each tileload* handler from the exact source it was registered on — see
    // the note on the contextLoadHandlers declaration above.
    for (const { source, type, handler } of this.contextLoadHandlers) {
      source.un(type, handler);
    }
    this.contextLoadHandlers = [];
    this.loadTracker.reset();
    this.onLoadingChange = null;
    this.map.setTarget(undefined);
    this.map = null;
    this.basemapLayer = null;
    this.mousePosition = null;
    this.layers = {};
    this.waterLayers = {};
    this.riversOverviewLayer = null;
    this.highlightedRiverId = null;
    this.waterVersionsSettled = false;
    if (this.waterVersionsTimer !== null) clearTimeout(this.waterVersionsTimer);
    this.waterVersionsTimer = null;
  }
}
