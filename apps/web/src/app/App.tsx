import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from './providers/AppProviders';
import TopBar from '../widgets/top-bar';
import Shell from '../features/shell';
import AdminUsersRoute from '../pages/admin-users';
import MapView from '../features/map/ui/MapView';
import LayersPanel from '../features/layers-panel';
import MapToolbar from '../features/map/ui/MapToolbar';
import DynamicPopup from '../components/DynamicPopup';
import Legend from '../features/legend';
import OGCClient from '../components/OGCClient';
import { IconRail } from '../features/shell/ui/IconRail.view';
import { useRail } from '../features/shell/model/useRail';
import { Layers, List } from 'lucide-react';
import '../styles/main.css';

function App() {
  const rail = useRail();

  return (
    <AppProviders>
      <BrowserRouter>
        <div className="app-container">
          {/* MapView is a SIBLING of <Routes>, never inside one: navigating to
              /admin/users overlays a live map instead of unmounting it, so
              center/zoom/layer state survives navigation. */}
          <MapView flyoutOpen={rail.active !== null} />
          <MapToolbar />

          <TopBar />

          {/* Left: doing. Burger drawer with the editing tools (editor/admin). */}
          <Shell />

          {/* Left: seeing. Icon rail + docked flyout replace the floating panels. */}
          <IconRail
            items={[
              { id: 'layers', label: 'Lớp dữ liệu', icon: <Layers size={20} /> },
              { id: 'legend', label: 'Chú giải', icon: <List size={20} /> },
            ]}
            active={rail.active}
            onToggle={rail.toggle}
          />
          {rail.active !== null && (
            <aside className="rail-flyout">
              {rail.active === 'layers' && <LayersPanel />}
              {rail.active === 'legend' && <Legend />}
            </aside>
          )}

          <OGCClient />

          <DynamicPopup />

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
