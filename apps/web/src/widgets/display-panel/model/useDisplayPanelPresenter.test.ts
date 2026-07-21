import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDisplayPanelPresenter } from './useDisplayPanelPresenter';

let currentSelection: unknown = null;
let personas: string[] = ['public'];

vi.mock('../../../entities/selection', () => ({
  useSelection: () => ({ selection: currentSelection, clear: vi.fn() }),
}));

vi.mock('../../../entities/persona/usePersona', () => ({
  usePersona: () => ({ available: personas }),
}));

const damSelection = {
  layerKey: 'dams',
  featureId: 'a1',
  feature: { fake: 'f' },
  isoProps: { geographicalName: 'Hoa Binh', statusSlug: 'xa_lu' },
};

beforeEach(() => {
  currentSelection = null;
  personas = ['public'];
});

describe('useDisplayPanelPresenter', () => {
  it('is absent when nothing is selected', () => {
    const { result } = renderHook(() => useDisplayPanelPresenter());
    expect(result.current.visible).toBe(false);
  });

  it('titles the panel with the feature name and tags its layer', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useDisplayPanelPresenter());

    expect(result.current.visible).toBe(true);
    expect(result.current.title).toBe('Hoa Binh');
    expect(result.current.layerLabel).toBe('Đập & Hồ chứa');
  });

  it('falls back to the feature id when the feature has no name', () => {
    currentSelection = { ...damSelection, isoProps: {} };
    const { result } = renderHook(() => useDisplayPanelPresenter());
    expect(result.current.title).toBe('a1');
  });

  it('hides the pen for a viewer and shows it for a steward', () => {
    currentSelection = damSelection;

    const viewer = renderHook(() => useDisplayPanelPresenter());
    expect(viewer.result.current.canEdit).toBe(false);

    personas = ['steward'];
    const steward = renderHook(() => useDisplayPanelPresenter());
    expect(steward.result.current.canEdit).toBe(true);
  });

  it('collapses and expands without dropping the selection', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useDisplayPanelPresenter());

    act(() => { result.current.toggleCollapse(); });
    expect(result.current.collapsed).toBe(true);
    expect(result.current.visible).toBe(true);

    act(() => { result.current.toggleCollapse(); });
    expect(result.current.collapsed).toBe(false);
  });

  it('re-expands when a new feature is selected', () => {
    currentSelection = damSelection;
    const { result, rerender } = renderHook(() => useDisplayPanelPresenter());
    act(() => { result.current.toggleCollapse(); });
    expect(result.current.collapsed).toBe(true);

    currentSelection = { ...damSelection, featureId: 'b2' };
    rerender();

    expect(result.current.collapsed).toBe(false);
  });
});
