import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from './providers/AppProviders';
import AdminUsersRoute from '../pages/admin-users';
import PrintRoute from '../pages/print';
import MapScreen from './MapScreen';
import DynamicPopup from '../components/DynamicPopup';
import ProposedEdit from '../features/feature-editing/ProposedEdit';
import '../styles/main.css';

function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <div className="app-container">
          {/* MapScreen (and the MapView in it) is a SIBLING of <Routes>, never
              inside one: navigating to /admin/users overlays a live map instead
              of unmounting it, so center/zoom/layer state survives navigation. */}
          <MapScreen />

          <DynamicPopup />

          <ProposedEdit />

          <Routes>
            <Route path="/" element={null} />
            <Route path="/print" element={<PrintRoute />} />
            <Route path="/admin/users" element={<AdminUsersRoute />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
