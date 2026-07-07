import React from 'react';
import { useMapContext } from './MapContext';
import { List } from 'lucide-react';

const DynamicLegend: React.FC = () => {
  const { layersState } = useMapContext();
  
  // Filter only visible layers
  const visibleLayers = layersState.filter(l => l.visible);

  if (visibleLayers.length === 0) return null;

  return (
    <div className="dynamic-legend glass-panel">
      <div className="legend-header">
        <List size={16} />
        <span className="font-semibold text-sm">Chú giải</span>
      </div>
      
      <div className="legend-content">
        {visibleLayers.map(layer => {
          if (layer.id === 'layer_dams') {
            return (
              <div key={layer.id} className="legend-item-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '2px solid rgba(59, 130, 246, 0.3)', paddingLeft: '8px', marginTop: '4px' }}>
                <span className="legend-label-header" style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)' }}>Đập & Hồ chứa (Đồ giải)</span>
                
                {/* Trạng thái (Màu sắc) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Theo Trạng thái:</div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="legend-color-box" style={{ background: '#10b981', width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' }}></span>
                    <span className="legend-label" style={{ fontSize: '12px' }}>Bình thường</span>
                  </div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="legend-color-box" style={{ background: '#f59e0b', width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' }}></span>
                    <span className="legend-label" style={{ fontSize: '12px' }}>Xả lũ</span>
                  </div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="legend-color-box" style={{ background: '#ef4444', width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' }}></span>
                    <span className="legend-label" style={{ fontSize: '12px' }}>Nguy hiểm</span>
                  </div>
                </div>

                {/* Công suất (Kích thước) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px', marginTop: '2px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Theo Công suất:</div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px' }}>
                      <span style={{ background: '#6b7280', width: '6px', height: '6px', borderRadius: '50%' }}></span>
                    </span>
                    <span className="legend-label" style={{ fontSize: '12px' }}>Nhỏ (&lt; 200 MW)</span>
                  </div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px' }}>
                      <span style={{ background: '#6b7280', width: '11px', height: '11px', borderRadius: '50%' }}></span>
                    </span>
                    <span className="legend-label" style={{ fontSize: '12px' }}>Vừa (200 - 1000 MW)</span>
                  </div>
                  <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px' }}>
                      <span style={{ background: '#6b7280', width: '16px', height: '16px', borderRadius: '50%' }}></span>
                    </span>
                    <span className="legend-label" style={{ fontSize: '12px' }}>Lớn (&gt; 1000 MW)</span>
                  </div>
                </div>
              </div>
            );
          }
          if (layer.id === 'layer_rivers') {
            return (
              <div key={layer.id} className="legend-item">
                <span className="legend-color-box" style={{ background: '#0ea5e9', height: '3px' }}></span>
                <span className="legend-label">Sông ngòi</span>
              </div>
            );
          }
          if (layer.id === 'layer_stations') {
            return (
              <div key={layer.id} className="legend-item">
                <span className="legend-color-box" style={{ background: '#10b981', borderRadius: '50%', border: '1.5px solid #ffffff' }}></span>
                <span className="legend-label">Trạm quan trắc</span>
              </div>
            );
          }
          if (layer.id === 'layer_flood') {
            return (
              <div key={layer.id} className="legend-item">
                <span className="legend-color-box" style={{ background: 'rgba(239, 68, 68, 0.4)', border: '1px solid #ef4444' }}></span>
                <span className="legend-label">Vùng ngập lụt</span>
              </div>
            );
          }
          if (layer.id === 'layer_drought_survey') {
            return (
              <div key={layer.id} className="legend-item">
                <span className="legend-color-box" style={{ background: '#b45309', borderRadius: '50%', border: '1.5px solid #ffffff' }}></span>
                <span className="legend-label">Khảo sát hạn hán</span>
              </div>
            );
          }
          if (layer.id === 'layer_saltwater_intrusion') {
            return (
              <div key={layer.id} className="legend-item">
                <span className="legend-color-box" style={{ background: '#7c3aed', borderRadius: '50%', border: '1.5px solid #ffffff' }}></span>
                <span className="legend-label">Xâm nhập mặn</span>
              </div>
            );
          }
          if (layer.id === 'layer_flood_generation') {
            return (
              <div key={layer.id} className="legend-item">
                <span className="legend-color-box" style={{ background: 'rgba(79, 70, 229, 0.4)', border: '1px solid #4f46e5' }}></span>
                <span className="legend-label">Vùng sinh lũ</span>
              </div>
            );
          }
          if (layer.id === 'layer_provinces_2026') {
            return (
              <div key={layer.id} className="legend-item">
                <span className="legend-color-box" style={{ background: 'rgba(239, 246, 255, 0.55)', border: '2px solid #4338ca' }}></span>
                <span className="legend-label">Ranh giới tỉnh</span>
              </div>
            );
          }
          if (layer.id === 'layer_wards_2026') {
            return (
              <div key={layer.id} className="legend-item">
                <span className="legend-color-box" style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px dashed #6b7280' }}></span>
                <span className="legend-label">Ranh giới xã/phường</span>
              </div>
            );
          }
          
          return null;
        })}
      </div>
    </div>
  );
};

export default DynamicLegend;
