import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FLOOD_DOCK_HEIGHT_VAR, watchFloodDock } from './floodDockHeight';

let callback: ResizeObserverCallback;
const observe = vi.fn();
const unobserve = vi.fn();
const disconnect = vi.fn();

describe('watchFloodDock', () => {
  beforeEach(() => {
    observe.mockReset(); unobserve.mockReset(); disconnect.mockReset();
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) { callback = cb; }
      observe = observe; unobserve = unobserve; disconnect = disconnect;
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const dockEl = () => { const d = document.createElement('div'); d.className = 'flood-dock'; return d; };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('sets the variable from the observed height and clears it when the dock unmounts', async () => {
    const stage = document.createElement('div');
    const dock = dockEl();
    stage.appendChild(dock);
    const stop = watchFloodDock(stage);
    expect(observe).toHaveBeenCalledWith(dock);
    callback([{ target: dock, contentRect: { height: 150 }, borderBoxSize: [{ blockSize: 187.4 }] } as never], {} as never);
    expect(stage.style.getPropertyValue(FLOOD_DOCK_HEIGHT_VAR)).toBe('187px');
    stage.removeChild(dock);
    await flush();
    expect(unobserve).toHaveBeenCalledWith(dock);
    expect(stage.style.getPropertyValue(FLOOD_DOCK_HEIGHT_VAR)).toBe('');
    stop();
  });

  it('picks up a dock that opens later, and stopping clears the variable', async () => {
    const stage = document.createElement('div');
    const stop = watchFloodDock(stage);
    expect(observe).not.toHaveBeenCalled();
    const dock = dockEl();
    stage.appendChild(dock);
    await flush();
    expect(observe).toHaveBeenCalledWith(dock);
    callback([{ target: dock, contentRect: { height: 200 } } as never], {} as never);
    expect(stage.style.getPropertyValue(FLOOD_DOCK_HEIGHT_VAR)).toBe('200px');
    stop();
    expect(stage.style.getPropertyValue(FLOOD_DOCK_HEIGHT_VAR)).toBe('');
    expect(disconnect).toHaveBeenCalled();
  });
});
