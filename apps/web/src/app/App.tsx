import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from './providers/AppProviders';
import AuthWidget from '../features/auth';
import Shell from '../features/shell';
import MapView from '../features/map/ui/MapView';
import BasemapSwitcher from '../components/BasemapSwitcher';
import LayerTree from '../components/LayerTree';
import MapControls from '../components/MapControls';
import SearchBar from '../components/SearchBar';
import DynamicPopup from '../components/DynamicPopup';
import DynamicLegend from '../components/DynamicLegend';
import OGCClient from '../components/OGCClient';
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import '../styles/main.css';

function App() {
  const [panelsVisible, setPanelsVisible] = useState(true);

  return (
    <AppProviders>
      <BrowserRouter>
        <div className="app-container">
          {/* MapView is a SIBLING of <Routes>, never inside one: navigating to
              /admin/users must overlay a live map, not unmount it. */}
          <MapView />
          <MapControls />

          <div className="auth-widget-slot">
            <AuthWidget />
          </div>

          <Shell />

          <div className={`panels-wrapper ${panelsVisible ? '' : 'hidden'}`}>
            <LayerTree />
            <BasemapSwitcher />
            <SearchBar />
            <DynamicLegend />
            <OGCClient />
          </div>

          <DynamicPopup />

          <button
            className="toggle-panels-btn glass-panel"
            onClick={() => setPanelsVisible(!panelsVisible)}
            title={panelsVisible ? 'Ẩn các panel' : 'Hiện các panel'}
          >
            {panelsVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            <span>{panelsVisible ? 'Ẩn giao diện' : 'Hiện giao diện'}</span>
          </button>

          <Routes>
            <Route path="/" element={null} />
          </Routes>
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
