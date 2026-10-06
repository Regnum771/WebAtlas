import { describe, it, expect, beforeEach } from 'vitest';
import { getShell, openTool, toggleTool, closeTool, toggleAssistant, closeAssistant, resetShell } from './shell.store';

beforeEach(() => { resetShell(); });

describe('shell store', () => {
  it('starts with nothing open', () => {
    expect(getShell()).toEqual({ assistantOpen: false, tool: null });
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
    expect(getShell()).toEqual({ assistantOpen: true, tool: 'measure' });
  });

  it('closeAssistant leaves the tool alone', () => {
    toggleAssistant();
    openTool('measure');
    closeAssistant();
    expect(getShell()).toEqual({ assistantOpen: false, tool: 'measure' });
  });
});
