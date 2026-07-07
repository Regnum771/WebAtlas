import { useState } from 'react';
import { MapProvider } from './components/MapContext';
import MapContainer from './components/MapContainer';
import BasemapSwitcher from './components/BasemapSwitcher';
import LayerTree from './components/LayerTree';
import MapControls from './components/MapControls';
import SearchBar from './components/SearchBar';
import DynamicPopup from './components/DynamicPopup';
import DynamicLegend from './components/DynamicLegend';
import OGCClient from './components/OGCClient';
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import './styles/main.css';

function App() {
  const [panelsVisible, setPanelsVisible] = useState(true);

  return (
    <MapProvider>
      <div className="app-container">
        <MapContainer />

        {/* MapControls luôn hiển thị (góc trên cùng bên phải) */}
        <MapControls />

        {/* Các panel có thể ẩn/hiện */}
        <div className={`panels-wrapper ${panelsVisible ? '' : 'hidden'}`}>
          <LayerTree />
          <BasemapSwitcher />
          <SearchBar />
          <DynamicLegend />
          <DynamicPopup />
          <OGCClient />
        </div>

        {/* Nút ẩn/hiện các panel */}
        <button
          className="toggle-panels-btn glass-panel"
          onClick={() => setPanelsVisible(!panelsVisible)}
          title={panelsVisible ? 'Ẩn các panel' : 'Hiện các panel'}
        >
          {panelsVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          <span>{panelsVisible ? 'Ẩn giao diện' : 'Hiện giao diện'}</span>
        </button>
      </div>
    </MapProvider>
  );
}

export default App;
