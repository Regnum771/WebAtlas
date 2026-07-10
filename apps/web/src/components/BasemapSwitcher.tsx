import React from 'react';
import { useMapContext, type BasemapType } from '../app/providers/MapProvider';
import { Map, Layers, Mountain } from 'lucide-react';

const BasemapSwitcher: React.FC = () => {
  const { basemap, setBasemap } = useMapContext();

  const options: { id: BasemapType; label: string; icon: React.ReactNode }[] = [
    { id: 'street', label: 'Đường phố', icon: <Map size={18} /> },
    { id: 'satellite', label: 'Vệ tinh', icon: <Layers size={18} /> },
    { id: 'dem', label: 'Địa hình', icon: <Mountain size={18} /> }
  ];

  return (
    <div className="basemap-switcher glass-panel">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => setBasemap(opt.id)}
          className={`basemap-btn ${basemap === opt.id ? 'active' : ''}`}
          title={opt.label}
        >
          {opt.icon}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
};

export default BasemapSwitcher;
