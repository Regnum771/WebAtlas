import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SelectionProvider } from './SelectionProvider';
import { useSelection } from './useSelection';

const selectByIdMock = vi.fn();
const clearMock = vi.fn();
let capturedOnChange: ((sel: unknown) => void) | null = null;

vi.mock('./SelectionController', () => ({
  SelectionController: class {
    activate(onChange: (sel: unknown) => void) { capturedOnChange = onChange; }
    selectById(...args: unknown[]) { return selectByIdMock(...args); }
    clear() { clearMock(); }
    dispose() {}
  },
}));

// Stable map reference: a fresh object per call would give the SelectionProvider's
// useEffect(..., [map]) a new dependency identity on every render, causing it to
// dispose/recreate the controller repeatedly and leave `capturedOnChange` stale by
// the time a test invokes it. Same pattern as mapEditing.test.tsx's `fakeMap`.
const fakeMap = { fake: 'map' };
vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ map: fakeMap }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SelectionProvider>{children}</SelectionProvider>
);

describe('SelectionProvider', () => {
  it('starts with no selection', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    expect(result.current.selection).toBeNull();
  });

  it('exposes the selection the controller reports', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    act(() => { capturedOnChange?.({ layerKey: 'dams', featureId: 'a1' }); });

    expect(result.current.selection).toEqual({ layerKey: 'dams', featureId: 'a1' });
  });

  it('delegates selectById and clear to the controller', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    act(() => { result.current.selectById('dams', 'a1'); });
    act(() => { result.current.clear(); });

    expect(selectByIdMock).toHaveBeenCalledWith('dams', 'a1');
    expect(clearMock).toHaveBeenCalled();
  });

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useSelection())).toThrow(/SelectionProvider/);
  });
});
