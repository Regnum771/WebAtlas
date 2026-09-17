import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from './providers/AppProviders';
import TopBar from '../widgets/top-bar';
import Shell from '../features/shell';
import AdminUsersRoute from '../pages/admin-users';
import MapView from '../features/map/ui/MapView';
import LayersPanel from '../features/layers-panel';
import MapToolbar from '../features/map/ui/MapToolbar';
import MapLoadingBar from '../features/map/ui/MapLoadingBar';
import DynamicPopup from '../components/DynamicPopup';
import Legend from '../features/legend';
import OGCClient from '../components/OGCClient';
import Assistant from '../features/assistant';
import ProposedEdit from '../features/feature-editing/ProposedEdit';
import { IconRail } from '../features/shell/ui/IconRail.view';
import { useRail } from '../features/shell/model/useRail';
import { useSession } from '../entities/session/model/session.store';
import { Layers, List, MessageSquare } from 'lucide-react';
import '../styles/main.css';

function RailAndFlyout() {
  const rail = useRail();
  const { status } = useSession();
  // The assistant costs API tokens per message, so the route is authenticated;
  // showing the entry to an anonymous visitor would only ever produce a 401.
  const items = [
    { id: 'layers' as const, label: 'Lớp dữ liệu', icon: <Layers size={20} /> },
    { id: 'legend' as const, label: 'Chú giải', icon: <List size={20} /> },
    ...(status === 'authenticated'
      ? [{ id: 'assistant' as const, label: 'Trợ lý', icon: <MessageSquare size={20} /> }]
      : []),
  ];

  // Logging out removes the rail entry above, but does not by itself close an
  // already-open panel. Close it here instead — only reacts to `status`
  // leaving 'authenticated', so it never fires while the user is logged in
  // and cannot fight their own rail.toggle clicks.
  useEffect(() => {
    if (status !== 'authenticated' && rail.active === 'assistant') {
      rail.toggle('assistant');
    }
  }, [status, rail.active, rail.toggle]);

  return (
    <>
      <MapView flyoutOpen={rail.active !== null} />
      <MapLoadingBar flyoutOpen={rail.active !== null} />
      <MapToolbar flyoutOpen={rail.active !== null} />
      <IconRail items={items} active={rail.active} onToggle={rail.toggle} />
      {rail.active !== null && (
        <aside className="rail-flyout">
          {rail.active === 'layers' && <LayersPanel />}
          {rail.active === 'legend' && <Legend />}
          {rail.active === 'assistant' && <Assistant />}
        </aside>
      )}
    </>
  );
}

function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <div className="app-container">
          {/* MapView is a SIBLING of <Routes>, never inside one: navigating to
              /admin/users overlays a live map instead of unmounting it, so
              center/zoom/layer state survives navigation. */}
          <RailAndFlyout />

          <TopBar />

          {/* Left: doing. Burger drawer with the editing tools (admin only). */}
          <Shell />

          <OGCClient />

          <DynamicPopup />

          <ProposedEdit />

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
