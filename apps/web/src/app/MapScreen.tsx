import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChartSpline, FilePlus2, Layers, PencilLine, Printer, Ruler, SquareDashed, Waves } from 'lucide-react';
import TopBar from '../widgets/top-bar';
import MapView from '../features/map/ui/MapView';
import MapLoadingBar from '../features/map/ui/MapLoadingBar';
import { ZoomControls } from '../features/map/ui/ScaleSlider';
import StatusBar from '../features/map/ui/StatusBar';
import { ToolGroupView, type ToolDef } from '../features/map/ui/ToolGroup.view';
import MeasureTool from '../features/map/ui/MeasureTool';
import BasemapTool from '../features/map/ui/BasemapTool';
import AddData from '../features/add-data';
import FeatureEditing from '../features/feature-editing';
import MyMaps, { PersonalTable } from '../features/my-maps';
import CatalogueLayersSection from '../features/catalogue';
import TimeRow from '../features/time-row';
import { useTimeSlider } from '../features/time-slider/model/timeSlider.store';
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
import { DockView } from '../features/shell/ui/Dock.view';
import { RailView } from '../features/shell/ui/Rail.view';
import ForecastDock from '../features/forecast-dock';
import {
  closeAssistant, closeDock, closeTool, getShell, openDock, openTool, toggleAssistant, toggleContents, toggleForecastDock, toggleTool,
  useShell, type ToolId,
} from '../features/shell/model/shell.store';
import { DOCK_COLUMN_QUERY, useMediaQuery } from '../shared/lib/useMediaQuery';
import { useSession } from '../entities/session/model/session.store';
import { useCanSaveDirectly } from '../entities/session/model/useCanSaveDirectly';
import { primeAdminUnits } from '../entities/admin-unit/adminUnits.store';
import { ConnectionStrip } from '../shared/ui/ConnectionStrip';
import { ToastHost } from '../shared/ui/ToastHost';

/** The map page: one grid holding the top bar, the map stage (rail, floating contents panel, tools) and the dock. */
export default function MapScreen() {
  const { status } = useSession();
  const { dock, contentsCollapsed, tool } = useShell();
  // From 1100 px the dock is a page column; below, a drawer over the map (Dock.view.tsx).
  const dockAsColumn = useMediaQuery(DOCK_COLUMN_QUERY);
  const roi = useRoi();
  const analysis = useAnalysisTools();
  const flood = useFloodScenario();
  const slider = useTimeSlider();
  // Update and review on a common unit (shared canSaveDirectly), or admin.
  const canEdit = useCanSaveDirectly();
  // A feature drawing or edit-existing mode is active in Biên tập.
  const [editBusy, setEditBusy] = useState(false);
  const navigate = useNavigate();

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

  // Opening a flood scenario (from its tool menu, the dock or the assistant) opens the dock on
  // Tổng quan; a new analysis result opens it on Phân tích (K4 plan, decision 4).
  // The Kịch bản lũ menu has done its job once the scenario is in the dock.
  useEffect(() => {
    if (!flood.scenarioId) return;
    openDock('overview');
    if (getShell().tool === 'flood') closeTool();
  }, [flood.scenarioId]);
  const analysisResult = analysis.result?.result ?? null;
  useEffect(() => { if (analysisResult) openDock('analysis'); }, [analysisResult]);

  useEffect(() => { void primeAdminUnits(); }, []);

  // The assistant costs API tokens per message, so it is authenticated-only;
  // showing it to an anonymous visitor would only ever produce a 401.
  const signedIn = status === 'authenticated';
  const assistantShown = signedIn && dock === 'assistant';
  const dockShown = dock === 'forecast' || assistantShown;
  let dockNode: ReactNode = null;
  if (dockShown) {
    dockNode = (
      <DockView
        variant={dockAsColumn ? 'column' : 'drawer'}
        title={assistantShown ? 'Trợ lý' : 'Dự báo và phân tích'}
        closeLabel={assistantShown ? 'Đóng trợ lý' : 'Đóng khung phân tích'}
        onClose={closeDock}
      >
        {/* Both views stay mounted while the dock is open, so switching between them keeps
            Trợ lý's conversation; the one not shown is hidden. */}
        {signedIn && <div hidden={!assistantShown} className="h-full"><Assistant /></div>}
        <div hidden={assistantShown}><ForecastDock analysis={analysis.result} /></div>
      </DockView>
    );
  }

  // Every tool's content stays mounted while its menu is closed (see ToolGroupView):
  // RoiChip keeps the map's ROI layer in step with the store, and the measure and
  // analysis tools hold state that must outlive a closed menu.
  const icon = (Icon: typeof Ruler) => <Icon size={16} aria-hidden="true" />;
  const tools: ToolDef[] = [
    { id: 'measure', label: 'Đo', icon: icon(Ruler), stack: 'analysis', content: <MeasureTool active={tool === 'measure'} /> },
    {
      id: 'roi',
      label: 'Vùng phân tích',
      icon: icon(SquareDashed),
      stack: 'analysis',
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
    // Trắc diện độ cao is one of the analysis tools: it opens Vùng phân tích's menu.
    { id: 'profile', label: 'Trắc diện độ cao', icon: icon(ChartSpline), stack: 'analysis', opens: 'roi' },
    { id: 'print', label: 'In và xuất', icon: icon(Printer), stack: 'analysis', onSelect: () => navigate('/print') },
    { id: 'add-data', label: 'Thêm dữ liệu', icon: icon(FilePlus2), stack: 'data', content: <AddData /> },
    { id: 'flood', label: 'Kịch bản lũ', icon: icon(Waves), stack: 'data', on: flood.scenarioId !== null, content: <FloodScenarioToolContent /> },
  ];
  // UX only: FeatureEditing keeps its own RequireSaveDirectly gate and the backend enforces every write.
  // Closing Biên tập (or the session ending, which unmounts it) cancels a feature
  // drawing and leaves edit-existing mode: FeatureEditing does it when `active` drops.
  if (canEdit) {
    tools.push({
      id: 'edit',
      label: 'Biên tập',
      icon: icon(PencilLine),
      stack: 'data',
      on: editBusy,
      content: <FeatureEditing active={tool === 'edit'} onBusyChange={setEditBusy} />,
    });
  }
  tools.push({ id: 'basemap', label: 'Nền bản đồ', icon: icon(Layers), stack: 'basemap', content: <BasemapTool /> });

  return (
    <AppShellView
      topBar={<TopBar />}
      strip={<ConnectionStrip />}
      stage={(
        <>
          {/* The map and everything floating on it; a personal layer's table docks under it
              and the map shrinks to the space left (MapView follows its box's size). */}
          <div
            className="map-stage-map"
            data-contents={contentsCollapsed ? 'collapsed' : 'open'}
            data-dock={dockShown && !dockAsColumn ? 'drawer' : undefined}
          >
            {/* MapView lives here, never inside a <Route>: navigating to
                /quan-ly overlays a live map instead of unmounting it. */}
            <MapView />
            <MapLoadingBar />
            {/* The rail and, right of it, the contents panel float over the map's top-left corner. */}
            <RailView
              contentsOpen={!contentsCollapsed} onContents={toggleContents}
              forecastOpen={dock === 'forecast'} onForecast={toggleForecastDock}
              assistant={signedIn ? { open: assistantShown, onToggle: toggleAssistant } : null}
            />
            <SidePanelView collapsed={contentsCollapsed} footer={<Link to="/print" className="link">In và xuất</Link>}>
              <MyMaps />
              {status === 'authenticated' && <hr className="side-panel-rule" />}
              <CatalogueLayersSection time={slider.time} />
              <LayersPanel />
              <Legend />
              <FloodLegend />
            </SidePanelView>
            <ToolGroupView
              before={<ZoomControls />}
              tools={tools}
              open={tool}
              onToggle={(id) => toggleTool(id as ToolId)}
              onClose={closeTool}
            />
            <FloodScenario />
            {/* R8: the time row sits directly above the status bar while a time layer is on. */}
            <TimeRow />
            <ToastHost />
            {/* R8: the bottom edge of the map, never covered. */}
            <StatusBar />
            {/* Below 1100 px the dock is a drawer over the map's right edge, inside the stage. */}
            {!dockAsColumn && dockNode}
          </div>
          <PersonalTable />
        </>
      )}
      dock={dockAsColumn ? dockNode : null}
    />
  );
}
