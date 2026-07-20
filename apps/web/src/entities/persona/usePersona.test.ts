import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let mockRole: string | null = null;
vi.mock('../session/model/session.store', () => ({
  useSession: () => ({ currentUser: mockRole ? { id: '1', email: 'a@b.test', full_name: 'A', role: mockRole } : null }),
}));

import { usePersona, PERSONA_STORAGE_KEY } from './usePersona';

beforeEach(() => { localStorage.clear(); mockRole = null; });

describe('usePersona', () => {
  it('anonymous resolves to public with no rail personas beyond public', () => {
    mockRole = null;
    const { result } = renderHook(() => usePersona());
    expect(result.current.available).toEqual(['public']);
    expect(result.current.active).toBe('public');
  });

  it('viewer defaults to the first available persona (governance)', () => {
    mockRole = 'viewer';
    const { result } = renderHook(() => usePersona());
    expect(result.current.available).toEqual(['governance', 'research']);
    expect(result.current.active).toBe('governance');
  });

  it('viewer restores a valid stored pick (research)', () => {
    mockRole = 'viewer';
    localStorage.setItem(PERSONA_STORAGE_KEY, 'research');
    const { result } = renderHook(() => usePersona());
    expect(result.current.active).toBe('research');
  });

  it('setActive persists a valid pick', () => {
    mockRole = 'viewer';
    const { result } = renderHook(() => usePersona());
    act(() => result.current.setActive('research'));
    expect(result.current.active).toBe('research');
    expect(localStorage.getItem(PERSONA_STORAGE_KEY)).toBe('research');
  });

  it('ignores a stored pick that is invalid for the role (falls back to first available)', () => {
    mockRole = 'editor'; // only steward
    localStorage.setItem(PERSONA_STORAGE_KEY, 'governance'); // not allowed for editor
    const { result } = renderHook(() => usePersona());
    expect(result.current.active).toBe('steward');
  });

  it('setActive rejects an id not available to the role', () => {
    mockRole = 'editor';
    const { result } = renderHook(() => usePersona());
    act(() => result.current.setActive('admin')); // not allowed
    expect(result.current.active).toBe('steward'); // unchanged
    expect(localStorage.getItem(PERSONA_STORAGE_KEY)).not.toBe('admin');
  });

  it('malformed localStorage does not throw and falls back', () => {
    mockRole = 'viewer';
    localStorage.setItem(PERSONA_STORAGE_KEY, '{not valid persona}');
    const { result } = renderHook(() => usePersona());
    expect(result.current.active).toBe('governance');
  });
});
