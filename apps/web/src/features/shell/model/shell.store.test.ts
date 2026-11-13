import { describe, it, expect, beforeEach } from 'vitest';
import {
  getShell, openTool, toggleTool, closeTool, toggleAssistant, closeAssistant, resetShell,
  openDock, closeDock, toggleForecastDock, setDockTab, toggleContents,
} from './shell.store';

beforeEach(() => { resetShell(); });

describe('shell store', () => {
  it('starts with nothing open', () => {
    expect(getShell()).toEqual({ dock: null, dockTab: 'overview', contentsCollapsed: false, tool: null, assistantOpen: false });
  });

  it('opening a tool closes the one that was open', () => {
    openTool('measure');
    openTool('roi');
    expect(getShell().tool).toBe('roi');
  });

  it('toggling the open tool closes it', () => {
    toggleTool('basemap');
    expect(getShell().tool).toBe('basemap');
    toggleTool('basemap');
    expect(getShell().tool).toBeNull();
  });

  it('toggling another tool switches to it', () => {
    toggleTool('edit');
    toggleTool('add-data');
    expect(getShell().tool).toBe('add-data');
  });

  it('closeTool closes whichever tool is open', () => {
    openTool('roi');
    closeTool();
    expect(getShell().tool).toBeNull();
  });

  it('the assistant and a tool can be open together', () => {
    toggleAssistant();
    openTool('measure');
    expect(getShell()).toMatchObject({ dock: 'assistant', assistantOpen: true, tool: 'measure' });
  });

  it('closeAssistant leaves the tool alone', () => {
    toggleAssistant();
    openTool('measure');
    closeAssistant();
    expect(getShell()).toMatchObject({ dock: null, assistantOpen: false, tool: 'measure' });
  });

  it('Trợ lý and the forecast view share the dock', () => {
    openDock('levels');
    expect(getShell()).toMatchObject({ dock: 'forecast', dockTab: 'levels', assistantOpen: false });
    toggleAssistant();
    expect(getShell()).toMatchObject({ dock: 'assistant', dockTab: 'levels', assistantOpen: true });
    closeAssistant();
    expect(getShell().dock).toBeNull();
  });

  it('closeAssistant leaves the forecast view open', () => {
    openDock();
    closeAssistant();
    expect(getShell().dock).toBe('forecast');
  });

  it('openDock without a tab keeps the last tab; setDockTab changes it', () => {
    setDockTab('analysis');
    openDock();
    expect(getShell().dockTab).toBe('analysis');
  });

  it('toggleForecastDock opens and closes the forecast view', () => {
    toggleForecastDock();
    expect(getShell().dock).toBe('forecast');
    toggleForecastDock();
    expect(getShell().dock).toBeNull();
  });

  it('opening the dock folds the contents panel once, and closing it gives the panel back', () => {
    openDock();
    expect(getShell().contentsCollapsed).toBe(true);
    toggleContents();
    expect(getShell().contentsCollapsed).toBe(false);
    toggleAssistant(); // switching the dock's view is not opening it
    expect(getShell().contentsCollapsed).toBe(false);
    closeAssistant();
    expect(getShell().contentsCollapsed).toBe(false);
  });

  it('closing the dock restores a panel the dock folded', () => {
    openDock();
    closeDock();
    expect(getShell().contentsCollapsed).toBe(false);
  });

  it('a panel folded before the dock opened stays folded after it closes', () => {
    toggleContents();
    openDock();
    closeDock();
    expect(getShell().contentsCollapsed).toBe(true);
  });
});
