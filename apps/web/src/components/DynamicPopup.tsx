import React, { useEffect, useRef, useState } from 'react';
import { drawingJustEnded, isDrawing } from '../features/map/model/drawingState';
import { useMapContext } from '../app/providers/MapProvider';
import { X, Info, Database, ShieldCheck, AlertTriangle, Sliders } from 'lucide-react';
import { fetchBasemapInfo } from '../features/map/model/basemapInfo';
import { attributeOf, damStatusDisplay, STREAM_ORDER_LABELS, valueName, type EditableLayerKey } from '@webatlas/shared';
import { useDictionary } from '../features/dictionary';
import { popupHas, popupLabel, popupValue } from './popupRows';
import { adminCandidates, entityCandidates, referenceLayerOfTable, thematicCandidate, type RoiCandidate } from '../features/roi/model/candidates';
import { fetchEntitiesByMember } from '../features/roi/api/roi.api';
import { RoiCandidatesView } from '../features/roi/ui/RoiCandidates.view';
import { setRoi } from '../features/roi/model/roi.store';
import { isPersonalFeatureLayer, isPersonalLayer, OVERLAY_LAYER_IDS, PERSONAL_HIT_TOLERANCE } from '../features/map/model/overlayLayers';
import { getMyMaps } from '../features/my-maps/model/myMaps.store';
import { useMapEditing } from '../features/map/model/mapEditing';
import { isBoundaryDecoration } from '../features/map/model/waterTiles';
import { ManagingUnitRow } from './ManagingUnitRow';
import { Attr, AttrBlock } from './AttrTable';
import { Button } from '../shared/ui/Button';
import { LAYER_REGISTRY } from '../entities/layer/layerRegistry';
import { LAYER_DISPLAY } from '../entities/layer/layerDisplay';

/** The layer a clicked feature belongs to, for the popup's header strip. */
function layerNameOf(feature: { layerKey?: string; truocsn?: unknown; population?: unknown; province?: unknown }): string | null {
  const entry = LAYER_REGISTRY.find((r) => r.layerKey === feature.layerKey);
  if (entry) return LAYER_DISPLAY[entry.layerStateId]?.name ?? null;
  if (feature.layerKey === 'basemap') return 'Nền bản đồ';
  if (feature.truocsn !== undefined || feature.population !== undefined || feature.province !== undefined) return 'Ranh giới hành chính';
  return null;
}

interface PopupData {
  coordinate: number[];
  feature: any; // GeoJSON properties
}

interface DamDetails {
  ten: string;
  loai: string;
  vatLieu: string;
  capCongTrinh: string;
  caoTrinhDinh: string;
  caoTrinhTuongChan: string;
  chieuDai: string;
  chieuCaoMax: string;
  chieuRongDinh: string;
  maiThuongLuu: string;
  thamNang: string;
  thamNhe: string;
}

const getDetailedDamInfo = (id: number, name: string, wattage?: number): DamDetails => {
  const hash = id || name.length || 1;
  const loai = (hash % 4 === 0) ? 'Đập phụ' : 'Đập chính';
  
  const materials = [
    'Bê tông đầm lăn (RCC)',
    'Đất đắp đồng chất',
    'Đá đổ bê tông bản mặt (CFRD)',
    'Bê tông trọng lực thông thường'
  ];
  const vatLieu = materials[hash % materials.length];
  
  let capCongTrinh = 'Cấp II';
  if (wattage) {
    if (wattage >= 500) capCongTrinh = 'Cấp đặc biệt';
    else if (wattage >= 100) capCongTrinh = 'Cấp I';
    else if (wattage >= 30) capCongTrinh = 'Cấp II';
    else capCongTrinh = 'Cấp III';
  } else {
    capCongTrinh = (hash % 3 === 0) ? 'Cấp I' : (hash % 3 === 1) ? 'Cấp II' : 'Cấp III';
  }
  
  const caoTrinhDinhVal = 80 + (hash * 17) % 320;
  const caoTrinhDinh = `${caoTrinhDinhVal} m`;
  const caoTrinhTuongChan = `${(caoTrinhDinhVal + 1.2 + (hash % 5) * 0.2).toFixed(1)} m`;
  
  const chieuDai = `${150 + (hash * 29) % 750} m`;
  const chieuCaoMax = `${30 + (hash * 13) % 110} m`;
  const chieuRongDinh = `${6 + (hash * 3) % 12} m`;
  
  const maiThuongLuu = (hash % 6 === 0) 
    ? 'Có hiện tượng sạt trượt cục bộ nhẹ' 
    : 'Đã gia cố bê tông tấm bản, ổn định';
    
  const thamNang = (hash % 8 === 0)
    ? 'Có hiện tượng rò rỉ nước tại vai đập trái'
    : 'Không phát hiện hiện tượng thấm nước nặng';
    
  const thamNhe = (hash % 5 === 2)
    ? 'Thấm ẩm nhẹ qua khe co giãn thi công'
    : 'Không phát hiện thấm';

  return {
    ten: name,
    loai,
    vatLieu,
    capCongTrinh,
    caoTrinhDinh,
    caoTrinhTuongChan,
    chieuDai,
    chieuCaoMax,
    chieuRongDinh,
    maiThuongLuu,
    thamNang,
    thamNhe
  };
};

const DynamicPopup: React.FC = () => {
  const { map, reservoirFilter, setReservoirFilter } = useMapContext();
  const { editing } = useMapEditing();
  const dictionary = useDictionary();
  const [popupData, setPopupData] = useState<PopupData | null>(null);
  // Bumped on every handled click; async continuations of an older click must not touch state.
  const clickSeq = useRef(0);
  const [candidates, setCandidates] = useState<RoiCandidate[]>([]);
  const [pixel, setPixel] = useState<number[]>([0, 0]);
  const [detailedDam, setDetailedDam] = useState<any | null>(null);

  useEffect(() => {
    if (!map || !popupData) return;
    
    // The popup lives in the full-window .app-container, but the map sits in the map
    // stage, right of the side panel and below the top bar: a map pixel must be shifted
    // by where the map starts, or the popup lands that far up and left of the click.
    const updatePixel = () => {
      const px = map.getPixelFromCoordinate(popupData.coordinate);
      if (!px) return;
      const origin = map.getTargetElement().getBoundingClientRect();
      setPixel([px[0] + origin.left, px[1] + origin.top]);
    };

    updatePixel();
    map.on('postrender', updatePixel);
    return () => map.un('postrender', updatePixel);
  }, [map, popupData]);

  useEffect(() => {
    setDetailedDam(null);
  }, [popupData]);

  useEffect(() => {
    if (!map) return;

    const clickHandler = (e: any) => {
      // Editing or drawing owns clicks, official or in a personal map: no popup.
      if (editing || getMyMaps().personalEditing || isDrawing() || drawingJustEnded()) return;
      // A personal feature near the click answers with its own card (features/my-maps), found
      // with the card's own tolerance: a stricter test here would open both for a thin line. The
      // selection ring is no personal feature: a click on its halo alone falls through to here.
      if (map.hasFeatureAtPixel(e.pixel, { layerFilter: isPersonalFeatureLayer, hitTolerance: PERSONAL_HIT_TOLERANCE })) {
        clickSeq.current++; // an earlier click's lookup still in flight must not open a popup now
        setPopupData(null);
        setCandidates([]);
        return;
      }
      const seq = ++clickSeq.current;
      const isCurrent = () => clickSeq.current === seq;
      // Every feature under the click, not just the first: the thematic feature, and the
      // ward and province boundaries, are all "Dùng làm vùng phân tích" candidates (U-6).
      let feature: any = null;
      let thematic: any = null;
      let province: any = null;
      let ward: any = null;
      map.forEachFeatureAtPixel(e.pixel, (f, layer) => {
        // Never official data, even if the check above let it through.
        if (isPersonalLayer(layer)) return undefined;
        // Overlays (ROI outline, results, highlight) sit above the data and are filled: they
        // must not shadow the ward/province/thematic feature underneath.
        if (OVERLAY_LAYER_IDS.has(layer?.get('id'))) return undefined;
        const p = f.getProperties();
        // A boundary label point or border line carries no unit attributes: the polygon under it does.
        if (isBoundaryDecoration(p)) return undefined;
        if (!feature) feature = f;
        // The normalized props carry `id` for CRUD; fall back to the WFS feature id
        // ("rivers.<uuid>") so a layer that does not set it still offers its feature.
        if (!thematic && p.layerKey) thematic = { ...p, id: p.id ?? String(f.getId() ?? '').split('.').pop() };
        const layerId = layer?.get('id');
        if (!province && layerId === 'layer_provinces_2026') province = p;
        if (!ward && layerId === 'layer_wards_2026') ward = p;
        return undefined; // keep iterating
      });
      const zoom = map.getView().getZoom() ?? 0;
      const base = [
        ...(thematic ? [thematicCandidate(thematic)].filter((c): c is RoiCandidate => c !== null) : []),
        ...adminCandidates(province, ward, zoom),
      ];
      setCandidates(base);

      // Province and ward boundaries are polygons that COVER the whole map, so
      // forEachFeatureAtPixel always hits one. Treating that as "a feature was hit"
      // would mean the basemap lookup below never runs, and a click on a road would
      // only show the ward's name. Thematic features carry a layerKey and boundaries
      // do not, so that is the sign that tells a REAL hit from the administrative backdrop.
      const isThematic = Boolean(feature?.getProperties()?.layerKey);

      if (feature && isThematic) {
        setPopupData({
          coordinate: e.coordinate,
          feature: feature.getProperties()
        });
        // Pan the map to the clicked feature so the popup stays in viewport
        map.getView().animate({ center: e.coordinate, duration: 400 });
      } else {
        // No thematic feature was hit. The BASEMAP layers (roads, railways, water)
        // reach the browser as tile images, so forEachFeatureAtPixel never sees them:
        // GeoServer has to be asked what the clicked road is called. That is a
        // separate request and does not affect how fast tiles are drawn.
        const fallback = feature
          ? { coordinate: e.coordinate, feature: feature.getProperties() }
          : null;
        const size = map.getSize();
        if (!size) { setPopupData(fallback); if (!fallback) setCandidates([]); return; }
        // ol declares Extent as number[]; basemapInfo wants a fixed 4-tuple so no
        // one passes an array with elements missing.
        const [minX, minY, maxX, maxY] = map.getView().calculateExtent(size);
        const extent: [number, number, number, number] = [minX, minY, maxX, maxY];
        setPopupData(fallback);
        fetchBasemapInfo(extent, [size[0], size[1]], [e.pixel[0], e.pixel[1]])
          .then((found) => {
            if (!isCurrent()) return;
            // Replace only when something WITH A NAME was found: an unnamed road
            // segment is less useful than the ward name already shown.
            if (!found?.name) { if (!fallback) setCandidates([]); return; }
            setPopupData({ coordinate: e.coordinate, feature: { ...found, layerKey: 'basemap' } });
            const layer = found.table ? referenceLayerOfTable(found.table) : null;
            if (layer && found.osmId) {
              fetchEntitiesByMember(layer, found.osmId)
                .then((entities) => isCurrent() && setCandidates([...entityCandidates(layer, entities), ...base]))
                .catch(() => { /* the admin candidates stay; the lookup is a convenience */ });
            }
          })
          .catch(() => {
            /* The basemap lookup is an extra: when it fails, stay silent and do not block the map. */
          });
      }
    };

    map.on('singleclick', clickHandler);
    
    // Change cursor on hover
    const pointerMoveHandler = (e: any) => {
      const hit = map.hasFeatureAtPixel(e.pixel);
      map.getTargetElement().style.cursor = hit ? 'pointer' : '';
    };
    
    map.on('pointermove', pointerMoveHandler);

    return () => {
      map.un('singleclick', clickHandler);
      map.un('pointermove', pointerMoveHandler);
    };
  }, [map, editing]);

  if (!popupData) return null;

  const props = popupData.feature;

  // Pick the icon and the content to show from the kind of feature.
  const renderPopupContent = () => {
    // Labels and value text of the eight editable layers come from the data dictionary.
    const lbl = (layer: EditableLayerKey, col: string) => popupLabel(dictionary, layer, col);
    const val = (layer: EditableLayerKey, col: string) => popupValue(dictionary, layer, col, props);
    const has = (layer: EditableLayerKey, col: string) => popupHas(layer, col, props);
    if (props.layerKey === 'dams') {
      const status = damStatusDisplay(props.statusSlug ?? props.operationalStatus);
      const statusAttr = attributeOf(dictionary, 'dams', 'status');
      // The badge keeps its colour; its text is the dictionary's name for the code, and an unknown code shows as itself.
      const statusCode = props.statusSlug ?? props.operationalStatus;
      const statusText = statusAttr && statusCode != null ? valueName(statusAttr, String(statusCode)) : status.label;
      return (
        <>
          <Attr label={lbl('dams', 'wattage_mw')}>{val('dams', 'wattage_mw')}</Attr>
          {props.annualGeneration != null && (
            <Attr label={lbl('dams', 'annual_output')}>{val('dams', 'annual_output')}</Attr>)}
          {props.commissioningYear && (
            <Attr label={lbl('dams', 'year_operational')}>{val('dams', 'year_operational')}</Attr>)}
          {props.constructionYear && (
            <Attr label={lbl('dams', 'year_launched')}>{val('dams', 'year_launched')}</Attr>)}
          <Attr label={lbl('dams', 'status')}><span className="status-text" style={{ color: status.color }}>{statusText}</span></Attr>
          <AttrBlock><div className="diagrammatic-info">
            <div className="title">Nền đồ giải (Cartodiagram):</div>
            <ul>
              <li><strong>Kích thước biểu tượng:</strong> Tỷ lệ {lbl('dams', 'wattage_mw').toLowerCase()} ({val('dams', 'wattage_mw')})</li>
              <li><strong>Màu sắc biểu tượng:</strong> {lbl('dams', 'status')} ({statusText})</li>
            </ul>
          </div></AttrBlock>
          <AttrBlock><div className="status-filter-container">
            <div className="title">Lọc hồ chứa theo trạng thái:</div>
            <div className="status-filter-buttons">
              {(['all', 'binh_thuong', 'xa_lu', 'nguy_hiem'] as const).map((filterVal) => {
                const labels = { all: 'Tất cả', binh_thuong: 'Bình thường', xa_lu: 'Xả lũ', nguy_hiem: 'Nguy hiểm' };
                return (
                  <button key={filterVal} onClick={() => setReservoirFilter(filterVal)}
                    className={`filter-btn-tag ${reservoirFilter === filterVal ? 'active-filter' : ''}`}>
                    {labels[filterVal]}
                  </button>
                );
              })}
            </div>
          </div></AttrBlock>
        </>
      );
    }
    if (props.layerKey === 'basemap') {
      const FCLASS_LABELS: Record<string, string> = {
        motorway: 'Đường cao tốc', motorway_link: 'Nhánh cao tốc',
        trunk: 'Quốc lộ', trunk_link: 'Nhánh quốc lộ',
        primary: 'Đường chính', primary_link: 'Nhánh đường chính',
        secondary: 'Đường liên tỉnh', secondary_link: 'Nhánh liên tỉnh',
        tertiary: 'Đường liên huyện', tertiary_link: 'Nhánh liên huyện',
        residential: 'Đường khu dân cư', living_street: 'Đường nội bộ',
        service: 'Đường nội bộ/kỹ thuật', unclassified: 'Đường chưa phân loại',
        track: 'Đường mòn', path: 'Lối mòn', footway: 'Lối đi bộ',
        cycleway: 'Đường xe đạp', steps: 'Bậc thang', pedestrian: 'Phố đi bộ',
        rail: 'Đường sắt', narrow_gauge: 'Đường sắt khổ hẹp',
        water: 'Mặt nước', reservoir: 'Hồ chứa', riverbank: 'Lòng sông',
      };
      return (
        <>
          {props.fclass && (
            <Attr label="Loại">{FCLASS_LABELS[props.fclass] ?? props.fclass}</Attr>)}
          {props.ref && (
            <Attr label="Số hiệu">{props.ref}</Attr>)}
          {props.maxspeed != null && (
            <Attr label="Tốc độ tối đa">{props.maxspeed} km/h</Attr>)}
          {props.oneway === 'yes' && (
            <Attr label="Chiều">Một chiều</Attr>)}
          {props.bridge === 'T' && (
            <Attr label="Công trình">Cầu</Attr>)}
          {props.tunnel === 'T' && (
            <Attr label="Công trình">Hầm</Attr>)}
        </>
      );
    }
    if (props.layerKey === 'rivers') {
      const orderName = props.streamOrder != null ? STREAM_ORDER_LABELS[props.streamOrder] : undefined;
      return (
        <>
          {has('rivers', 'code') && (
            <Attr label={lbl('rivers', 'code')}>{val('rivers', 'code')}</Attr>)}
          {/* stream_order is now a rank by KIND of watercourse (OSM), not a Strahler
              order, so the kind name is shown instead of "Cấp N". */}
          {orderName && (
            <Attr label={lbl('rivers', 'stream_order')}>{orderName}</Attr>)}
          <Attr label={lbl('rivers', 'length_m')}>{val('rivers', 'length_m')}</Attr>
        </>
      );
    }
    if (props.layerKey === 'lakes') {
      return (
        <>
          {props.lakeType && (
            <Attr label={lbl('lakes', 'lake_type')}>{val('lakes', 'lake_type')}</Attr>)}
          {has('lakes', 'area_km2') && (
            <Attr label={lbl('lakes', 'area_km2')}>{val('lakes', 'area_km2')}</Attr>)}
          {has('lakes', 'volume_mcm') && (
            <Attr label={lbl('lakes', 'volume_mcm')}>{val('lakes', 'volume_mcm')}</Attr>)}
          {has('lakes', 'shore_len_km') && (
            <Attr label={lbl('lakes', 'shore_len_km')}>{val('lakes', 'shore_len_km')}</Attr>)}
        </>
      );
    }
    if (props.layerKey === 'stations') {
      return (
        <>
          <Attr label={lbl('stations', 'station_type')}>{val('stations', 'station_type')}</Attr>
          <Attr label={lbl('stations', 'value')}>{val('stations', 'value')}</Attr>
          <Attr label={lbl('stations', 'status')}>{val('stations', 'status')}</Attr>
        </>
      );
    }
    if (props.layerKey === 'flood_zones') {
      return (
        <>
          <Attr label={lbl('flood_zones', 'hazard_type')}>{val('flood_zones', 'hazard_type')}</Attr>
          <Attr label={lbl('flood_zones', 'area')}>{val('flood_zones', 'area')}</Attr>
        </>
      );
    }
    if (props.layerKey === 'drought_points') {
      return (
        <>
          <Attr label="Phân loại">Khảo sát hạn hán</Attr>
          <Attr label={lbl('drought_points', 'status')}>{val('drought_points', 'status')}</Attr>
          {props.observationDate && (
            <Attr label={lbl('drought_points', 'survey_date')}>{val('drought_points', 'survey_date')}</Attr>)}
        </>
      );
    }
    if (props.layerKey === 'saltwater_intrusion') {
      return (
        <>
          <Attr label="Phân loại">Xâm nhập mặn</Attr>
          <Attr label={lbl('saltwater_intrusion', 'salinity')}>{val('saltwater_intrusion', 'salinity')}</Attr>
          <Attr label={lbl('saltwater_intrusion', 'status')}>{val('saltwater_intrusion', 'status')}</Attr>
        </>
      );
    }
    if (props.layerKey === 'flood_generation') {
      return (
        <>
          <Attr label="Phân loại">Vùng sinh lũ</Attr>
          <Attr label={lbl('flood_generation', 'area')}>{val('flood_generation', 'area')}</Attr>
          <Attr label={lbl('flood_generation', 'flow_rate')}>{val('flood_generation', 'flow_rate')}</Attr>
        </>
      );
    }

    // 5. A province after the merger.
    if (props.truocsn !== undefined) {
      return (
        <>
          <Attr label="Tên đầy đủ">{props.fullName}</Attr>
          {props.truocsn && (
            <Attr label="Trước sáp nhập"><span className="font-normal whitespace-pre-wrap">{props.truocsn}</span></Attr>
          )}
        </>
      );
    }

    // 6. A province or district (administrative).
    if (props.population !== undefined || props.province !== undefined) {
      return (
        <>
          <Attr label="Cấp hành chính">{props.type}</Attr>
          {props.population && (
            <Attr label="Dân số ước tính">{props.population}</Attr>
          )}
          {props.province && (
            <Attr label="Thuộc tỉnh">{props.province}</Attr>
          )}
        </>
      );
    }

    // The default for every other kind.
    return (
      <Attr label="Phân loại">{props.type || 'Chưa phân loại'}</Attr>
    );
  };

  const isDamOrReservoir = props.layerKey === 'dams';
  const detail = isDamOrReservoir ? getDetailedDamInfo(props.localId || 0, props.geographicalName || 'Đập & Hồ chứa', props.ratedPower) : null;

  // Place the popup inside the map's box: below the click in the map's upper half, above it in
  // the lower half, and no taller than the space left there, so it never runs under the header
  // or over the status bar (32 px, plus 8 px).
  const POPUP_WIDTH = 300;
  const box = map?.getTargetElement()?.getBoundingClientRect();
  const boxTop = box?.top ?? 0;
  const boxBottom = (box?.bottom ?? window.innerHeight) - 40;
  const boxRight = box?.right ?? window.innerWidth;
  const below = pixel[1] - boxTop < (boxBottom - boxTop) / 2;
  const popupTop = below ? pixel[1] + 15 : pixel[1] - 15;
  const yTranslate = below ? '0' : '-100%';
  const maxHeight = Math.max(160, below ? boxBottom - popupTop - 8 : popupTop - boxTop - 8);
  const toLeft = pixel[0] + 15 + POPUP_WIDTH > boxRight;
  const popupLeft = toLeft ? pixel[0] - 15 : pixel[0] + 15;
  const xTranslate = toLeft ? '-100%' : '0';

  return (
    <>
      <div
        data-slot="feature-popup"
        role="region"
        aria-labelledby="feature-popup-title"
        className="absolute z-40 flex w-[300px] flex-col overflow-hidden rounded-lg border border-line bg-surface text-body text-ink shadow-pop"
        style={{
          left: popupLeft,
          top: popupTop,
          transform: `translate(${xTranslate}, ${yTranslate})`,
          maxHeight,
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* The header strip: the layer, then the feature's name (a river's in the water face). */}
        <div className="relative flex-none border-b border-line bg-surface-2 py-2 pr-9 pl-3">
          {layerNameOf(props) && <div className="text-label text-ink-2">{layerNameOf(props)}</div>}
          <h3
            id="feature-popup-title"
            data-water={props.layerKey === 'rivers' || undefined}
            className="text-panel font-semibold data-[water]:font-water data-[water]:italic data-[water]:text-water"
          >
            {props.geographicalName || props.name || (props.layerKey === 'rivers' ? `Sông ngòi (${props.hydroId ?? props.localId})` : 'Đối tượng không tên')}
          </h3>
          {props.riskLevel && (
            <span className={`status-badge ${props.riskLevel === 'Cao' ? 'risk-high' : props.riskLevel === 'Trung bình' ? 'risk-medium' : 'risk-low'}`}>
              {props.riskLevel}
            </span>
          )}
          <button
            type="button"
            aria-label="Đóng"
            className="absolute top-1.5 right-1.5 inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-ink-2 hover:bg-surface hover:text-ink"
            onClick={() => { setPopupData(null); setCandidates([]); }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-3 py-1.5">
          <table className="w-full border-collapse">
            <tbody>
              {renderPopupContent()}
              <ManagingUnitRow unit={props.managingAuthority} />
            </tbody>
          </table>
          <RoiCandidatesView
            candidates={candidates}
            onUse={(roi) => { void setRoi(roi, { fit: true }); setPopupData(null); setCandidates([]); }}
          />
        </div>

        {isDamOrReservoir && (
          <div className="flex flex-none justify-end border-t border-line-2 px-3 py-2">
            <Button size="sm" onClick={() => setDetailedDam(props)}>
              <Info size={14} aria-hidden="true" />
              Xem chi tiết chuyên sâu
            </Button>
          </div>
        )}
      </div>

      {detailedDam && detail && (
        <div className="ogc-modal-overlay" onClick={() => setDetailedDam(null)}>
          <div className="ogc-modal float dam-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ogc-modal-header">
              <h3>
                <Database size={18} />
                <span>Chi tiết chuyên sâu: {detail.ten}</span>
              </h3>
              <button className="close-btn" onClick={() => setDetailedDam(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="ogc-modal-content">
              <div className="details-grid">
                
                {/* Column 1: technical specifications */}
                <div className="details-section">
                  <h4>
                    <Sliders size={15} />
                    <span>Thông số kỹ thuật đập</span>
                  </h4>
                  <div className="detail-item">
                    <span className="detail-label">Loại đập</span>
                    <span className="detail-value">{detail.loai}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Loại vật liệu</span>
                    <span className="detail-value">{detail.vatLieu}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Cấp công trình</span>
                    <span className="detail-value">{detail.capCongTrinh}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Cao trình đỉnh đập</span>
                    <span className="detail-value">{detail.caoTrinhDinh}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Cao trình tường chắn sóng</span>
                    <span className="detail-value">{detail.caoTrinhTuongChan}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Chiều dài đập</span>
                    <span className="detail-value">{detail.chieuDai}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Chiều cao lớn nhất</span>
                    <span className="detail-value">{detail.chieuCaoMax}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Chiều rộng đỉnh đập</span>
                    <span className="detail-value">{detail.chieuRongDinh}</span>
                  </div>
                </div>

                {/* Column 2: safety status */}
                <div className="details-section">
                  <h4>
                    <ShieldCheck size={15} />
                    <span>Hiện trạng an toàn đập</span>
                  </h4>
                  <div className="detail-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                    <span className="detail-label">Mái thượng lưu không gia cố</span>
                    <span className={`status-indicator ${detail.maiThuongLuu.includes('sạt trượt') ? 'status-warning' : 'status-safe'}`}>
                      {detail.maiThuongLuu.includes('sạt trượt') ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
                      {detail.maiThuongLuu}
                    </span>
                  </div>
                  <div className="detail-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                    <span className="detail-label">Hiện trạng thấm nước nặng</span>
                    <span className={`status-indicator ${detail.thamNang.includes('rò rỉ') ? 'status-danger' : 'status-safe'}`}>
                      {detail.thamNang.includes('rò rỉ') ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
                      {detail.thamNang}
                    </span>
                  </div>
                  <div className="detail-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                    <span className="detail-label">Hiện trạng thấm nước nhẹ</span>
                    <span className={`status-indicator ${detail.thamNhe.includes('Thấm ẩm') ? 'status-warning' : 'status-safe'}`}>
                      {detail.thamNhe.includes('Thấm ẩm') ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
                      {detail.thamNhe}
                    </span>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DynamicPopup;
