import { useSyncExternalStore } from 'react';

export type ToolId = 'measure' | 'roi' | 'add-data' | 'basemap' | 'edit';
export interface ShellState { assistantOpen: boolean; tool: ToolId | null }

/** Which shell pieces are open. A module store, like toast.store.ts, so any widget can drive it. */
const INITIAL: ShellState = { assistantOpen: false, tool: null };
let state: ShellState = INITIAL;
const listeners = new Set<() => void>();
function publish(next: ShellState) {
  if (next.assistantOpen === state.assistantOpen && next.tool === state.tool) return;
  state = next;
  for (const l of listeners) l();
}

export function getShell(): ShellState { return state; }

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useShell(): ShellState { return useSyncExternalStore(subscribe, getShell); }

export function toggleAssistant(): void { publish({ ...state, assistantOpen: !state.assistantOpen }); }
export function closeAssistant(): void { publish({ ...state, assistantOpen: false }); }
/** Opening one tool closes any other. */
export function openTool(id: ToolId): void { publish({ ...state, tool: id }); }
export function toggleTool(id: ToolId): void { publish({ ...state, tool: state.tool === id ? null : id }); }
export function closeTool(): void { publish({ ...state, tool: null }); }

/** Tests only. */
export function resetShell(): void { publish(INITIAL); }
