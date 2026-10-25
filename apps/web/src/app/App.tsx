import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProviders } from './providers/AppProviders';
import { Spinner } from '../shared/ui/Spinner';
import PrintRoute from '../pages/print';
import MapScreen from './MapScreen';
import DynamicPopup from '../components/DynamicPopup';
import ProposedEdit from '../features/feature-editing/ProposedEdit';
import '../styles/main.css';

// The Quản lý area is rarely visited: keep it out of the main bundle.
const QuanLyRoute = lazy(() => import('../pages/quan-ly'));
const NhomQuyen = lazy(() => import('../pages/quan-ly/sections/NhomQuyen'));
const NguoiDung = lazy(() => import('../pages/quan-ly/sections/NguoiDung'));
const ChuaGan = lazy(() => import('../pages/quan-ly/sections/ChuaGan'));
const BanDoCaNhan = lazy(() => import('../pages/quan-ly/sections/BanDoCaNhan'));
const TuDien = lazy(() => import('../pages/quan-ly/sections/TuDien'));

// The data dictionary pages are rarely visited too.
const DuLieuRoute = lazy(() => import('../pages/du-lieu'));
const LayerPage = lazy(() => import('../pages/du-lieu/LayerPage'));

const loading = (
  <div className="quan-ly-route"><Spinner label="Đang tải…" /></div>
);

function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <div className="app-container">
          {/* MapScreen (and the MapView in it) is a SIBLING of <Routes>, never
              inside one: navigating to /quan-ly overlays a live map instead
              of unmounting it, so center/zoom/layer state survives navigation. */}
          <MapScreen />

          <DynamicPopup />

          <ProposedEdit />

          <Routes>
            <Route path="/" element={null} />
            <Route path="/print" element={<PrintRoute />} />
            <Route path="/du-lieu" element={<Suspense fallback={loading}><DuLieuRoute /></Suspense>} />
            <Route path="/du-lieu/:key" element={<Suspense fallback={loading}><LayerPage /></Suspense>} />
            <Route path="/admin/users" element={<Navigate to="/quan-ly/nguoi-dung" replace />} />
            <Route path="/quan-ly" element={<Suspense fallback={loading}><QuanLyRoute /></Suspense>}>
              <Route path="nhom-quyen" element={<Suspense fallback={loading}><NhomQuyen /></Suspense>} />
              <Route path="nguoi-dung" element={<Suspense fallback={loading}><NguoiDung /></Suspense>} />
              <Route path="chua-gan" element={<Suspense fallback={loading}><ChuaGan /></Suspense>} />
              <Route path="ban-do-ca-nhan" element={<Suspense fallback={loading}><BanDoCaNhan /></Suspense>} />
              <Route path="tu-dien" element={<Suspense fallback={loading}><TuDien /></Suspense>} />
            </Route>
          </Routes>
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
