import React, { useState } from 'react';
import { useMapContext } from '../app/providers/MapProvider';
import TileLayer from 'ol/layer/Tile';
import TileWMS from 'ol/source/TileWMS';
import { Globe, Plus, X } from 'lucide-react';

const OGCClient: React.FC = () => {
  const { map } = useMapContext();
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [layerName, setLayerName] = useState('');

  const handleAddWMS = () => {
    if (!map || !url || !layerName) return;

    try {
      const wmsLayer = new TileLayer({
        source: new TileWMS({
          url: url,
          params: { 'LAYERS': layerName, 'TILED': true },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
        }),
        properties: { id: `wms_${Date.now()}` }
      });

      map.addLayer(wmsLayer);
      setIsOpen(false);
      setUrl('');
      setLayerName('');
      alert(`Đã nạp thành công lớp dữ liệu: ${layerName}`);
    } catch (error) {
      alert('Lỗi khi nạp WMS URL. Vui lòng kiểm tra lại CORS hoặc URL.');
    }
  };

  return (
    <>
      <button 
        className="ogc-trigger-btn glass-panel"
        onClick={() => setIsOpen(true)}
        title="Nạp dữ liệu OGC (WMS)"
      >
        <Globe size={18} />
      </button>

      {isOpen && (
        <div className="ogc-modal-overlay">
          <div className="ogc-modal glass-panel">
            <div className="ogc-modal-header">
              <h3 className="font-semibold flex items-center gap-2">
                <Globe size={18} className="text-blue-500" />
                Tích hợp dữ liệu Bộ ngành (WMS)
              </h3>
              <button onClick={() => setIsOpen(false)} className="close-btn"><X size={18} /></button>
            </div>
            
            <div className="ogc-modal-content">
              <div className="input-group">
                <label>WMS Server URL</label>
                <input 
                  type="text" 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/geoserver/wms" 
                />
              </div>
              <div className="input-group">
                <label>Tên Lớp (Layer Name)</label>
                <input 
                  type="text" 
                  value={layerName}
                  onChange={(e) => setLayerName(e.target.value)}
                  placeholder="workspace:layer_name" 
                />
              </div>
              <button className="add-layer-btn" onClick={handleAddWMS}>
                <Plus size={16} /> Nạp vào bản đồ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OGCClient;
