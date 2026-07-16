import { useState } from 'react';
import { AppProviders } from './providers/AppProviders';
import AuthWidget from '../features/auth';
import FeatureEditing from '../features/feature-editing';
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
      <div className="app-container">
        <MapView />
        <MapControls />

        {/* Auth entry: login button or user badge */}
        <div className="auth-widget-slot">
          <AuthWidget />
          <FeatureEditing />
        </div>

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
      </div>
    </AppProviders>
  );
}

export default App;
