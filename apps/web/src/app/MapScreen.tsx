import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../widgets/top-bar';
import MapView from '../features/map/ui/MapView';
import MapLoadingBar from '../features/map/ui/MapLoadingBar';
import ScaleSlider from '../features/map/ui/ScaleSlider';
import { ToolGroupView, type ToolDef } from '../features/map/ui/ToolGroup.view';
import MeasureTool from '../features/map/ui/MeasureTool';
import BasemapTool from '../features/map/ui/BasemapTool';
import AddData from '../features/add-data';
import FeatureEditing from '../features/feature-editing';
import LayersPanel from '../features/layers-panel';
import Legend from '../features/legend';
import Assistant from '../features/assistant';
import FloodScenario, { FloodLegend, FloodScenarioToolContent } from '../features/flood-scenario';
import { useFloodScenario } from '../features/flood-scenario/model/flood.store';
import RoiChip from '../features/roi/ui/RoiChip';
import RoiDrawButtons from '../features/roi/ui/RoiDrawButtons';
import { stopDrawing, useRoi } from '../features/roi/model/roi.store';
import { useAnalysisTools } from '../features/analysis';
import { AppShellView } from '../features/shell/ui/AppShell.view';
import { SidePanelView } from '../features/shell/ui/SidePanel.view';
import { AssistantDockView } from '../features/shell/ui/AssistantDock.view';
import {
  closeAssistant, closeTool, getShell, openTool, toggleTool, useShell, type ToolId,
} from '../features/shell/model/shell.store';
import { useSession } from '../entities/session/model/session.store';
import { useCan } from '../entities/session/model/useCan';
import { primeAdminUnits } from '../entities/admin-unit/adminUnits.store';
import { ConnectionStrip } from '../shared/ui/ConnectionStrip';
import { ToastHost } from '../shared/ui/ToastHost';

/** The map page: one grid holding the top bar, the docked panel, the map stage and the assistant. */
export default function MapScreen() {
  const { status } = useSession();
  const { assistantOpen, tool } = useShell();
  const roi = useRoi();
  const analysis = useAnalysisTools();
  const flood = useFloodScenario();
  const can = useCan();
  const canEdit = can('feature.update') && can('submission.review');
  // A feature drawing or edit-existing mode is active in Biên tập.
  const [editBusy, setEditBusy] = useState(false);

  // Logging out hides the top bar's assistant button but would leave an
  // already-open dock behind. Only reacts to `status` leaving 'authenticated'.
  useEffect(() => {
    if (status !== 'authenticated') closeAssistant();
  }, [status]);

  // The edit tool is visible only to an admin or to a user holding update and review rights.
  // A session that ends, or loses those rights, while its menu is open would otherwise
  // leave the store pointing at a tool nobody can see.
  useEffect(() => {
    if (!canEdit && getShell().tool === 'edit') closeTool();
  }, [canEdit, tool]);

  // Closing Vùng phân tích cancels a drawing in progress; a finished region and any
  // result stay. stopDrawing does nothing unless a drawing is under way.
  useEffect(() => {
    if (tool !== 'roi') stopDrawing();
  }, [tool]);

  // Any change to the region — a pick from search or a popup, a failed pick, a message —
  // opens Vùng phân tích so its effect is seen. Compares with the previous state, so an
  // idle store on first mount, or a region that merely still exists, opens nothing.
  const seenRoi = useRef({ status: roi.status, error: roi.error, hint: roi.hint });
  useEffect(() => {
    const seen = seenRoi.current;
    seenRoi.current = { status: roi.status, error: roi.error, hint: roi.hint };
    const startedResolving = roi.status === 'resolving' && seen.status !== 'resolving';
    const newError = roi.error !== null && roi.error !== seen.error;
    const newHint = roi.hint !== null && roi.hint !== seen.hint;
    if (startedResolving || newError || newHint) openTool('roi');
  }, [roi.status, roi.error, roi.hint]);

  useEffect(() => { void primeAdminUnits(); }, []);

  // The assistant costs API tokens per message, so it is authenticated-only;
  // showing it to an anonymous visitor would only ever produce a 401.
  const dockOpen = status === 'authenticated' && assistantOpen;

  // Every tool's content stays mounted while its menu is closed (see ToolGroupView):
  // RoiChip keeps the map's ROI layer in step with the store, and the measure and
  // analysis tools hold state that must outlive a closed menu.
  const tools: (ToolDef & { id: ToolId })[] = [
    { id: 'measure', label: 'Đo', content: <MeasureTool active={tool === 'measure'} /> },
    {
      id: 'roi',
      label: 'Vùng phân tích',
      on: roi.resolved !== null,
      content: (
        <>
          <RoiChip />
          <RoiDrawButtons />
          {analysis.buttons}
          {analysis.panel}
        </>
      ),
    },
    { id: 'add-data', label: 'Thêm dữ liệu', content: <AddData /> },
    { id: 'basemap', label: 'Nền bản đồ', content: <BasemapTool /> },
    { id: 'flood', label: 'Kịch bản lũ', on: flood.scenarioId !== null, content: <FloodScenarioToolContent /> },
  ];
  // UX only: FeatureEditing keeps its own RequirePermission gate and the backend enforces every write.
  // Closing Biên tập (or the session ending, which unmounts it) cancels a feature
  // drawing and leaves edit-existing mode: FeatureEditing does it when `active` drops.
  if (canEdit) {
    tools.push({
      id: 'edit',
      label: 'Biên tập',
      on: editBusy,
      content: <FeatureEditing active={tool === 'edit'} onBusyChange={setEditBusy} />,
    });
  }

  return (
    <AppShellView
      topBar={<TopBar />}
      panel={(
        <SidePanelView footer={<Link to="/print" className="link">In và xuất</Link>}>
          <LayersPanel />
          <hr className="side-panel-rule" />
          <Legend />
          <FloodLegend />
        </SidePanelView>
      )}
      strip={<ConnectionStrip />}
      stage={(
        <>
          {/* MapView lives here, never inside a <Route>: navigating to
              /quan-ly overlays a live map instead of unmounting it. */}
          <MapView />
          <MapLoadingBar />
          <ToolGroupView
            tools={tools}
            open={tool}
            onToggle={(id) => toggleTool(id as ToolId)}
            onClose={closeTool}
          />
          <ScaleSlider />
          <FloodScenario />
          <ToastHost />
        </>
      )}
      assistant={dockOpen ? <AssistantDockView onClose={closeAssistant}><Assistant /></AssistantDockView> : null}
    />
  );
}
