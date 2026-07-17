import React, { useState } from 'react';
import { useMapContext } from '../app/providers/MapProvider';
import { layerGroups } from '../data/mockData';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import BasemapSwitcher from './BasemapSwitcher';

const LayerTree: React.FC = () => {
  const { layersState, toggleLayerVisibility, setLayerOpacity } = useMapContext();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'group_water_resources': true
  });

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  return (
    <div className="layer-tree glass-panel">
      <div className="layer-tree-header">
        <Layers />
        <h2>Quản lý Dữ liệu</h2>
      </div>
      
      <div className="layer-tree-content">
        <div className="layer-tree-section">
          <h3 className="layer-tree-section-title">Bản đồ nền</h3>
          <BasemapSwitcher />
        </div>
        {layerGroups.map(group => (
          <div key={group.id} className="mb-2">
            <button 
              onClick={() => toggleGroup(group.id)}
              className="group-btn"
            >
              {expandedGroups[group.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <span>{group.name}</span>
            </button>
            
            {expandedGroups[group.id] && (
              <div className="layers-list">
                {group.layers.map(layer => {
                  const state = layersState.find(s => s.id === layer.id);
                  if (!state) return null;
                  
                  return (
                    <div key={layer.id} className="layer-item">
                      <div className="layer-item-header">
                        <label className={`layer-label ${state.visible ? 'active' : 'inactive'}`}>
                          <input 
                            type="checkbox" 
                            checked={state.visible}
                            onChange={() => toggleLayerVisibility(layer.id)}
                          />
                          <span>{layer.name}</span>
                        </label>
                      </div>
                      
                      {state.visible && (
                        <div className="opacity-slider-container">
                          <span>Mờ</span>
                          <input 
                            type="range" 
                            min="0" max="1" step="0.05"
                            value={state.opacity}
                            onChange={(e) => setLayerOpacity(layer.id, parseFloat(e.target.value))}
                          />
                          <span>Rõ</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default LayerTree;
