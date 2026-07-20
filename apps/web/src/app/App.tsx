import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from './providers/AppProviders';
import TopBar from '../widgets/top-bar';
import Shell from '../features/shell';
import AdminUsersRoute from '../pages/admin-users';
import MapView from '../features/map/ui/MapView';
import LayerTree from '../components/LayerTree';
import MapControls from '../components/MapControls';
import SearchBar from '../components/SearchBar';
import DynamicPopup from '../components/DynamicPopup';
import DynamicLegend from '../components/DynamicLegend';
import OGCClient from '../components/OGCClient';
import { PanelRightOpen, PanelRightClose } from 'lucide-react';
import '../styles/main.css';

function App() {
  const [panelsVisible, setPanelsVisible] = useState(true);

  return (
    <AppProviders>
      <BrowserRouter>
        <div className="app-container">
          {/* MapView is a SIBLING of <Routes>, never inside one: navigating to
              /admin/users overlays a live map instead of unmounting it, so
              center/zoom/layer state survives navigation. */}
          <MapView />
          <MapControls />

          <TopBar />

          {/* Left: doing. Burger drawer with the editing tools (editor/admin). */}
          <Shell />

          <SearchBar />

          {/* Right: seeing. Layers + basemap + legend as one stacked panel. */}
          <div className={`panels-wrapper ${panelsVisible ? '' : 'hidden'}`}>
            <LayerTree />
            <DynamicLegend />
            <OGCClient />
          </div>

          <DynamicPopup />

          <button
            className="toggle-panels-btn glass-panel"
            onClick={() => setPanelsVisible(!panelsVisible)}
            title={panelsVisible ? 'Ẩn các panel' : 'Hiện các panel'}
          >
            {panelsVisible ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            <span>{panelsVisible ? 'Ẩn giao diện' : 'Hiện giao diện'}</span>
          </button>

          <Routes>
            <Route path="/" element={null} />
            <Route path="/admin/users" element={<AdminUsersRoute />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
