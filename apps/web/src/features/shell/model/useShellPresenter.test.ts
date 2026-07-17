import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let available: string[] = ['public'];
let active = 'public';
const setActive = vi.fn((id: string) => { active = id; });
vi.mock('../../../entities/persona/usePersona', () => ({
  usePersona: () => ({ available, active, setActive }),
}));

import { useShellPresenter } from './useShellPresenter';

beforeEach(() => { available = ['public']; active = 'public'; setActive.mockClear(); });

describe('useShellPresenter', () => {
  it('anonymous/public yields no workspaces', () => {
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.workspaces).toEqual([]);
  });

  it('viewer yields governance + research workspaces with labels', () => {
    available = ['governance', 'research']; active = 'governance';
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.workspaces.map((w) => w.id)).toEqual(['governance', 'research']);
    expect(result.current.workspaces[0].label).toBe('Governance');
  });

  it('admin workspaces exclude public and include steward + admin', () => {
    available = ['steward', 'admin']; active = 'steward';
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.workspaces.map((w) => w.id)).toEqual(['steward', 'admin']);
  });

  it('select sets the persona and opens the panel', () => {
    available = ['governance', 'research']; active = 'governance';
    const { result } = renderHook(() => useShellPresenter());
    act(() => result.current.select('research'));
    expect(setActive).toHaveBeenCalledWith('research');
    expect(result.current.isOpen).toBe(true);
  });

  it('close collapses the panel', () => {
    available = ['steward']; active = 'steward';
    const { result } = renderHook(() => useShellPresenter());
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });
});
