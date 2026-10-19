import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { buildUnitTree } from '@webatlas/shared';
import { useUnitPicker, normalizeText } from './useUnitPicker';

const TREE = buildUnitTree([
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
  { code: '01', level: 'province', parent: 'VN', name: 'Hà Nội' },
  { code: '20001', level: 'ward', parent: '48', name: 'Điện Hồng' },
  { code: '20002', level: 'ward', parent: '48', name: 'Hải Châu' },
  { code: '30001', level: 'ward', parent: '01', name: 'Ba Đình' },
]);

describe('normalizeText', () => {
  it('strips diacritics and maps đ', () => expect(normalizeText('Điện Hồng')).toBe('dien hong'));
});

describe('useUnitPicker', () => {
  it('lists VN then provinces; wards only once their province is expanded', () => {
    const { result } = renderHook(() => useUnitPicker(TREE, [], { onChange: vi.fn() }));
    expect(result.current.rows.map((r) => r.code)).toEqual(['VN', '01', '48']);
    act(() => result.current.toggleExpand('48'));
    expect(result.current.rows.map((r) => [r.code, r.depth])).toEqual([['VN', 0], ['01', 1], ['48', 1], ['20001', 2], ['20002', 2]]);
  });

  it('search finds a xã by name without diacritics', () => {
    const { result } = renderHook(() => useUnitPicker(TREE, [], { onChange: vi.fn() }));
    act(() => result.current.setQuery('dien hong'));
    expect(result.current.rows.map((r) => r.code)).toContain('20001');
    expect(result.current.rows.map((r) => r.code)).not.toContain('20002');
  });

  it('search also matches the code', () => {
    const { result } = renderHook(() => useUnitPicker(TREE, [], { onChange: vi.fn() }));
    act(() => result.current.setQuery('30001'));
    expect(result.current.rows.map((r) => r.code)).toContain('30001');
  });

  it('selecting a unit under a selected ancestor is a no-op and the row says so', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useUnitPicker(TREE, ['48'], { onChange }));
    act(() => result.current.toggleExpand('48'));
    const ward = result.current.rows.find((r) => r.code === '20001')!;
    expect(ward.coveredByAncestor).toBe(true);
    expect(ward.coveredByName).toBe('Đà Nẵng');
    act(() => result.current.toggle('20001'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('selecting an ancestor drops its selected descendants', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useUnitPicker(TREE, ['20001', '30001'], { onChange }));
    act(() => result.current.toggle('48'));
    expect(onChange).toHaveBeenCalledWith(['30001', '48']);
  });

  it('toggling a selected unit removes it', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useUnitPicker(TREE, ['48'], { onChange }));
    act(() => result.current.toggle('48'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('single mode selects exactly one unit and ignores ancestor coverage', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useUnitPicker(TREE, ['48'], { onChange, mode: 'single' }));
    act(() => result.current.toggleExpand('48'));
    expect(result.current.rows.find((r) => r.code === '20001')!.coveredByAncestor).toBe(false);
    act(() => result.current.toggle('20001'));
    expect(onChange).toHaveBeenCalledWith(['20001']);
  });

  it('allowed filter blocks toggling a disallowed unit', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useUnitPicker(TREE, [], { onChange, allowed: (c) => c !== '01' }));
    expect(result.current.rows.find((r) => r.code === '01')!.disabled).toBe(true);
    act(() => result.current.toggle('01'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
