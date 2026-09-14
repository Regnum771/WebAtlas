import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRail } from './useRail';

describe('useRail', () => {
  it('starts with the layers panel open', () => {
    const { result } = renderHook(() => useRail());
    expect(result.current.active).toBe('layers');
  });

  it('closes the active item when it is toggled again', () => {
    const { result } = renderHook(() => useRail());
    act(() => result.current.toggle('layers'));
    expect(result.current.active).toBeNull();
  });

  it('switches directly between items', () => {
    const { result } = renderHook(() => useRail());
    act(() => result.current.toggle('legend'));
    expect(result.current.active).toBe('legend');
    act(() => result.current.toggle('assistant'));
    expect(result.current.active).toBe('assistant');
  });
});
