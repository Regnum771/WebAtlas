import { useSyncExternalStore } from 'react';

export type ToolId = 'measure' | 'roi' | 'add-data' | 'basemap' | 'edit' | 'flood';
/** What the right-hand dock shows: the forecast and analysis tabs, or Trợ lý (spec assumption 5). */
export type DockView = 'forecast' | 'assistant';
export type DockTab = 'overview' | 'rain' | 'levels' | 'analysis';

export interface ShellState {
  dock: DockView | null;
  /** The forecast view's tab; kept while the dock is closed or shows Trợ lý. */
  dockTab: DockTab;
  /** The contents panel is folded away, leaving the rail. */
  contentsCollapsed: boolean;
  tool: ToolId | null;
  /** The dock shows Trợ lý (derived from `dock`, kept for the header and the palette). */
  assistantOpen: boolean;
}

/** Which shell pieces are open. A module store, like toast.store.ts, so any widget can drive it. */
const INITIAL: ShellState = { dock: null, dockTab: 'overview', contentsCollapsed: false, tool: null, assistantOpen: false };
let state: ShellState = INITIAL;
/** The panel's state before the dock opened, restored when it closes (the dock folds the panel once). */
let contentsBeforeDock: boolean | null = null;
const listeners = new Set<() => void>();

function publish(patch: Partial<ShellState>) {
  const next = { ...state, ...patch };
  next.assistantOpen = next.dock === 'assistant';
  if ((Object.keys(next) as (keyof ShellState)[]).every((k) => next[k] === state[k])) return;
  state = next;
  for (const l of listeners) l();
}

/**
 * Opening the dock from closed folds the contents panel to the rail, once: the reader may open it
 * again while the dock stays. Closing the dock gives the panel back the state it had before.
 */
function setDock(dock: DockView | null, patch: Partial<ShellState> = {}) {
  if (dock !== null && state.dock === null) {
    contentsBeforeDock = state.contentsCollapsed;
    publish({ ...patch, dock, contentsCollapsed: true });
  } else if (dock === null && state.dock !== null) {
    const restore = contentsBeforeDock;
    contentsBeforeDock = null;
    publish({ ...patch, dock, ...(restore !== null ? { contentsCollapsed: restore } : {}) });
  } else {
    publish({ ...patch, dock });
  }
}

export function getShell(): ShellState { return state; }

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useShell(): ShellState { return useSyncExternalStore(subscribe, getShell); }

export function toggleAssistant(): void { setDock(state.dock === 'assistant' ? null : 'assistant'); }
export function closeAssistant(): void { if (state.dock === 'assistant') setDock(null); }

/** Opens the forecast and analysis view, on `tab` or on the tab it had. */
export function openDock(tab?: DockTab): void { setDock('forecast', tab ? { dockTab: tab } : {}); }
export function toggleForecastDock(): void { setDock(state.dock === 'forecast' ? null : 'forecast'); }
export function closeDock(): void { setDock(null); }
export function setDockTab(tab: DockTab): void { publish({ dockTab: tab }); }
export function toggleContents(): void {
  // A choice made while the dock is open is the reader's: closing the dock keeps it.
  contentsBeforeDock = null;
  publish({ contentsCollapsed: !state.contentsCollapsed });
}

/** Opening one tool closes any other. */
export function openTool(id: ToolId): void { publish({ tool: id }); }
export function toggleTool(id: ToolId): void { publish({ tool: state.tool === id ? null : id }); }
export function closeTool(): void { publish({ tool: null }); }

/** Tests only. */
export function resetShell(): void { contentsBeforeDock = null; state = INITIAL; for (const l of listeners) l(); }
