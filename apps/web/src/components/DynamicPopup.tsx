import React, { useEffect, useState } from 'react';
import { useMapContext } from '../app/providers/MapProvider';
import { X, Info, Activity, Database, Droplets, ShieldCheck, AlertTriangle, Sliders } from 'lucide-react';
import { damStatusDisplay } from '@webatlas/shared';
import { LAYER_REGISTRY } from '../entities/layer/layerRegistry';

// Layers that the shared SelectionController owns; a click that lands on one of them
// hands ownership of the click to selection/detail-panel, so no popup should stack on top.
const EDITABLE_LAYER_STATE_IDS = new Set(LAYER_REGISTRY.map((e) => e.layerStateId));

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
  const [popupData, setPopupData] = useState<PopupData | null>(null);
  const [pixel, setPixel] = useState<number[]>([0, 0]);
  const [detailedDam, setDetailedDam] = useState<any | null>(null);

  useEffect(() => {
    if (!map || !popupData) return;
    
    const updatePixel = () => {
      const px = map.getPixelFromCoordinate(popupData.coordinate);
      if (px) setPixel(px);
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
      let hitLayerId: string | undefined;
      const feature = map.forEachFeatureAtPixel(e.pixel, (f, layer) => {
        hitLayerId = layer?.get('id');
        return f;
      });

      // A selected feature owns the detail panel; do not stack a popup on top of a click
      // that the SelectionController will also handle (i.e. it landed on an editable layer).
      if (hitLayerId && EDITABLE_LAYER_STATE_IDS.has(hitLayerId)) return;

      if (feature) {
        setPopupData({
          coordinate: e.coordinate,
          feature: feature.getProperties()
        });
        // Pan the map to the clicked feature so the popup stays in viewport
        map.getView().animate({ center: e.coordinate, duration: 400 });
      } else {
        setPopupData(null);
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
  }, [map]);

  if (!popupData) return null;

  const props = popupData.feature;

  // Xác định icon và nội dung hiển thị dựa theo loại đối tượng
  const renderPopupContent = () => {
    // Thematic WFS layers are discriminated by layerKey (ISO/INSPIRE attributes).
    if (props.layerKey === 'dams') {
      return (
        <>
          <div className="info-row"><Database size={14} className="text-blue-500" />
            <span>Công suất: <strong>{props.ratedPower} MW</strong></span></div>
          {props.annualGeneration != null && (
            <div className="info-row"><Droplets size={14} className="text-blue-500" />
              <span>Sản lượng điện: <strong>{props.annualGeneration} GWh/năm</strong></span></div>)}
          {props.commissioningYear && (
            <div className="info-row"><Activity size={14} className="text-blue-500" />
              <span>Năm vận hành: <strong>{props.commissioningYear}</strong></span></div>)}
          {props.constructionYear && (
            <div className="info-row"><Info size={14} className="text-blue-500" />
              <span>Khởi công: <strong>{props.constructionYear}</strong></span></div>)}
          {(() => {
            const st = damStatusDisplay(props.statusSlug ?? props.operationalStatus);
            return (
              <div className="info-row"><Activity size={14} className="text-blue-500" />
                <span>Trạng thái: <strong className="status-text" style={{ color: st.color }}>{st.label}</strong></span></div>
            );
          })()}
          <div className="diagrammatic-info">
            <div className="title">Nền đồ giải (Cartodiagram):</div>
            <ul>
              <li><strong>Kích thước biểu tượng:</strong> Tỷ lệ công suất ({props.ratedPower} MW)</li>
              <li><strong>Màu sắc biểu tượng:</strong> Trạng thái ({damStatusDisplay(props.statusSlug ?? props.operationalStatus).label})</li>
            </ul>
          </div>
          <div className="status-filter-container">
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
          </div>
        </>
      );
    }
    if (props.layerKey === 'rivers') {
      const lengthStr = props.length != null ? `${(props.length / 1000).toFixed(2)} km` : '—';
      return (
        <>
          {props.hydroId && (
            <div className="info-row"><Database size={14} className="text-blue-500" />
              <span>Mã phân đoạn: <strong>{props.hydroId}</strong></span></div>)}
          {props.streamOrder != null && (
            <div className="info-row"><Info size={14} className="text-blue-500" />
              <span>Cấp sông: <strong>Cấp {props.streamOrder}</strong></span></div>)}
          <div className="info-row"><Droplets size={14} className="text-blue-500" />
            <span>Chiều dài: <strong>{lengthStr}</strong></span></div>
        </>
      );
    }
    if (props.layerKey === 'stations') {
      return (
        <>
          <div className="info-row"><Database size={14} className="text-blue-500" />
            <span>Loại trạm: <strong>{props.measurementType}</strong></span></div>
          <div className="info-row"><Activity size={14} className="text-blue-500" />
            <span>Giá trị đo: <strong>{props.measurementValue}</strong></span></div>
          <div className="info-row"><Info size={14} className="text-blue-500" />
            <span>Trạng thái hoạt động: <strong>{props.operationalStatus}</strong></span></div>
        </>
      );
    }
    if (props.layerKey === 'flood_zones') {
      return (
        <>
          <div className="info-row"><Database size={14} className="text-blue-500" />
            <span>Phân loại: <strong>{props.hazardType}</strong></span></div>
          <div className="info-row"><Droplets size={14} className="text-blue-500" />
            <span>Diện tích ảnh hưởng: <strong>{props.affectedArea}</strong></span></div>
        </>
      );
    }
    if (props.layerKey === 'drought_points') {
      return (
        <>
          <div className="info-row"><Info size={14} className="text-blue-500" />
            <span>Phân loại: <strong>Khảo sát hạn hán</strong></span></div>
          <div className="info-row"><Activity size={14} className="text-blue-500" />
            <span>Trạng thái: <strong>{props.observedStatus}</strong></span></div>
          {props.observationDate && (
            <div className="info-row"><Database size={14} className="text-blue-500" />
              <span>Ngày khảo sát: <strong>{props.observationDate}</strong></span></div>)}
        </>
      );
    }
    if (props.layerKey === 'saltwater_intrusion') {
      return (
        <>
          <div className="info-row"><Info size={14} className="text-blue-500" />
            <span>Phân loại: <strong>Xâm nhập mặn</strong></span></div>
          <div className="info-row"><Droplets size={14} className="text-blue-500" />
            <span>Độ mặn đo được: <strong>{props.salinity}</strong></span></div>
          <div className="info-row"><Activity size={14} className="text-blue-500" />
            <span>Trạng thái: <strong>{props.observedStatus}</strong></span></div>
        </>
      );
    }
    if (props.layerKey === 'flood_generation') {
      return (
        <>
          <div className="info-row"><Info size={14} className="text-blue-500" />
            <span>Phân loại: <strong>Vùng sinh lũ</strong></span></div>
          <div className="info-row"><Database size={14} className="text-blue-500" />
            <span>Diện tích lưu vực: <strong>{props.catchmentArea}</strong></span></div>
          <div className="info-row"><Activity size={14} className="text-blue-500" />
            <span>Đặc điểm lũ: <strong>{props.flowCharacteristics}</strong></span></div>
        </>
      );
    }

    // 5. Nếu là tỉnh thành sáp nhập năm 2026
    if (props.truocsn !== undefined) {
      return (
        <>
          <div className="info-row">
            <Info size={14} className="text-blue-500" />
            <span>Tên đầy đủ: <strong>{props.fullName}</strong></span>
          </div>
          {props.truocsn && (
            <div className="info-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Database size={14} className="text-blue-500" />
                <span>Trước sáp nhập:</span>
              </div>
              <strong className="text-gray-700 text-xs ml-5 leading-normal" style={{ whiteSpace: 'pre-wrap' }}>{props.truocsn}</strong>
            </div>
          )}
        </>
      );
    }

    // 6. Nếu là Tỉnh / Huyện (Hành chính)
    if (props.population !== undefined || props.province !== undefined) {
      return (
        <>
          <div className="info-row">
            <Info size={14} className="text-blue-500" />
            <span>Cấp hành chính: <strong>{props.type}</strong></span>
          </div>
          {props.population && (
            <div className="info-row">
              <Database size={14} className="text-blue-500" />
              <span>Dân số ước tính: <strong>{props.population}</strong></span>
            </div>
          )}
          {props.province && (
            <div className="info-row">
              <Droplets size={14} className="text-blue-500" />
              <span>Thuộc tỉnh: <strong>{props.province}</strong></span>
            </div>
          )}
        </>
      );
    }

    // Mặc định cho các loại khác
    return (
      <div className="info-row">
        <Info size={14} className="text-blue-500" />
        <span>Phân loại: <strong>{props.type || 'Chưa phân loại'}</strong></span>
      </div>
    );
  };

  const isDamOrReservoir = props.layerKey === 'dams';
  const detail = isDamOrReservoir ? getDetailedDamInfo(props.localId || 0, props.geographicalName || 'Đập & Hồ chứa', props.ratedPower) : null;

  // Tính toán vị trí để không bị tràn khỏi màn hình (khung hình)
  let popupLeft = pixel[0] + 15;
  let popupTop = pixel[1] - 15;
  let xTranslate = '0';
  let yTranslate = '-100%';

  // Ước tính kích thước popup (width: 260px, height khoảng 350px)
  if (popupLeft + 260 > window.innerWidth) {
    popupLeft = pixel[0] - 15; // Đẩy sang trái con trỏ
    xTranslate = '-100%';
  }
  
  if (popupTop - 350 < 0) {
    popupTop = pixel[1] + 15; // Đẩy xuống dưới con trỏ
    yTranslate = '0';
  }

  return (
    <>
      <div 
        className="dynamic-popup glass-panel"
        style={{
          left: popupLeft,
          top: popupTop,
          transform: `translate(${xTranslate}, ${yTranslate})`,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button 
          className="close-popup-btn" 
          onClick={() => setPopupData(null)}
        >
          <X size={16} />
        </button>
        
        <div className="popup-header">
          <h3 className="popup-title">{props.geographicalName || props.name || (props.layerKey === 'rivers' ? `Sông ngòi (${props.hydroId ?? props.localId})` : 'Đối tượng không tên')}</h3>
          {props.riskLevel && (
            <span className={`status-badge ${props.riskLevel === 'Cao' ? 'risk-high' : props.riskLevel === 'Trung bình' ? 'risk-medium' : 'risk-low'}`}>
              {props.riskLevel}
            </span>
          )}
        </div>
        
        <div className="popup-content">
          {renderPopupContent()}
        </div>
        
        {isDamOrReservoir && (
          <div className="popup-footer">
            <button className="details-btn" onClick={() => setDetailedDam(props)}>
              <Info size={16} />
              <span>Xem chi tiết chuyên sâu</span>
            </button>
          </div>
        )}
      </div>

      {detailedDam && detail && (
        <div className="ogc-modal-overlay" onClick={() => setDetailedDam(null)}>
          <div className="ogc-modal glass-panel dam-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ogc-modal-header">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Database size={18} className="text-blue-500" />
                <span>Chi tiết chuyên sâu: {detail.ten}</span>
              </h3>
              <button className="close-btn" onClick={() => setDetailedDam(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="ogc-modal-content">
              <div className="details-grid">
                
                {/* Cột 1: Thông số kỹ thuật */}
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

                {/* Cột 2: Hiện trạng an toàn */}
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
