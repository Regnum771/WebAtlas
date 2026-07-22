import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let available: string[] = ['public'];
vi.mock('../../../entities/persona/usePersona', () => ({
  usePersona: () => ({ available, active: available[0], setActive: vi.fn() }),
}));

import { useShellPresenter } from './useShellPresenter';

beforeEach(() => { available = ['public']; });

describe('useShellPresenter', () => {
  it('gives every role a drawer, and gates only the edit section', () => {
    // viewer
    const viewer = renderHook(() => useShellPresenter());
    expect(viewer.result.current.canEdit).toBe(false);
  });

  it('governance/research get a drawer but cannot edit', () => {
    available = ['governance', 'research'];
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.canEdit).toBe(false);
  });

  it('editor (steward) can edit', () => {
    available = ['steward'];
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.canEdit).toBe(true);
  });

  it('admin can edit (steward is in its persona set)', () => {
    available = ['steward', 'admin'];
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.canEdit).toBe(true);
  });

  it('starts CLOSED (a drawer must never ambush the user on load)', () => {
    available = ['steward'];
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.isOpen).toBe(false);
  });

  it('toggle opens then closes', () => {
    available = ['steward'];
    const { result } = renderHook(() => useShellPresenter());
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });

  it('close collapses an open drawer', () => {
    available = ['steward'];
    const { result } = renderHook(() => useShellPresenter());
    act(() => result.current.toggle());
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });
});
