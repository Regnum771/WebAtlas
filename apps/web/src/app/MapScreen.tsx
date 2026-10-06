import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../widgets/top-bar';
import MapView from '../features/map/ui/MapView';
import MapLoadingBar from '../features/map/ui/MapLoadingBar';
import ScaleSlider from '../features/map/ui/ScaleSlider';
import MapToolbar from '../features/map/ui/MapToolbar';
import LayersPanel from '../features/layers-panel';
import Legend from '../features/legend';
import Assistant from '../features/assistant';
import RoiChip from '../features/roi/ui/RoiChip';
import RoiDrawButtons from '../features/roi/ui/RoiDrawButtons';
import { useAnalysisTools } from '../features/analysis';
import { AppShellView } from '../features/shell/ui/AppShell.view';
import { SidePanelView } from '../features/shell/ui/SidePanel.view';
import { AssistantDockView } from '../features/shell/ui/AssistantDock.view';
import { closeAssistant, useShell } from '../features/shell/model/shell.store';
import { useSession } from '../entities/session/model/session.store';
import { primeAdminUnits } from '../entities/admin-unit/adminUnits.store';
import { ConnectionStrip } from '../shared/ui/ConnectionStrip';
import { ToastHost } from '../shared/ui/ToastHost';

/** The map page: one grid holding the top bar, the docked panel, the map stage and the assistant. */
export default function MapScreen() {
  const { status } = useSession();
  const { assistantOpen } = useShell();
  const analysis = useAnalysisTools();

  // Logging out hides the top bar's assistant button but would leave an
  // already-open dock behind. Only reacts to `status` leaving 'authenticated'.
  useEffect(() => {
    if (status !== 'authenticated') closeAssistant();
  }, [status]);

  useEffect(() => { void primeAdminUnits(); }, []);

  // The assistant costs API tokens per message, so it is authenticated-only;
  // showing it to an anonymous visitor would only ever produce a 401.
  const dockOpen = status === 'authenticated' && assistantOpen;

  return (
    <AppShellView
      topBar={<TopBar />}
      panel={(
        <SidePanelView footer={<Link to="/print" className="link">In và xuất</Link>}>
          <LayersPanel />
          <hr className="side-panel-rule" />
          <Legend />
        </SidePanelView>
      )}
      strip={<ConnectionStrip />}
      stage={(
        <>
          {/* MapView lives here, never inside a <Route>: navigating to
              /admin/users overlays a live map instead of unmounting it. */}
          <MapView />
          <MapLoadingBar />
          <MapToolbar analysisButtons={analysis.buttons} analysisPanel={analysis.panel} roiChip={<RoiChip />} drawButtons={<RoiDrawButtons />} />
          <ScaleSlider />
          <ToastHost />
        </>
      )}
      assistant={dockOpen ? <AssistantDockView onClose={closeAssistant}><Assistant /></AssistantDockView> : null}
    />
  );
}
