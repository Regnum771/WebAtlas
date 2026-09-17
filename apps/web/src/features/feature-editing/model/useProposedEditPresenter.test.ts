import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { FeatureEditProposal } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';

const updateFeature = vi.fn();
vi.mock('../api/features.api', () => ({ updateFeature: (...a: unknown[]) => updateFeature(...a) }));

import { useProposedEditPresenter } from './useProposedEditPresenter';

const P: FeatureEditProposal = {
  kind: 'proposeFeatureEdit', layerKey: 'dams', featureId: 'f1', name: 'Sông Hinh',
  current: { name: 'Sông Hinh', wattage_mw: '70', status: null },
  proposed: { wattage_mw: '72' },
  sourceDocument: 'QĐ 123',
};

// Braces matter here: `mockReset()` returns the mock itself, and an arrow
// function's implicit return would hand that function back to Vitest as this
// hook's teardown callback — which Vitest then invokes after each test,
// running whatever implementation (e.g. mockRejectedValue) was set by then.
beforeEach(() => { updateFeature.mockReset(); });

describe('useProposedEditPresenter', () => {
  it('prefills current values overlaid with proposed ones and marks changes', () => {
    const { result } = renderHook(() => useProposedEditPresenter(P, { onSaved: vi.fn() }));
    expect(result.current.values.wattage_mw).toBe('72');
    expect(result.current.values.name).toBe('Sông Hinh');
    expect(result.current.values.status).toBe('');
    expect(result.current.isChanged('wattage_mw')).toBe(true);
    expect(result.current.isChanged('name')).toBe(false);
    expect(result.current.previous('wattage_mw')).toBe('70');
    expect(result.current.columns).not.toContain('external_id');
  });

  it('cannot save until both source fields are filled', () => {
    const { result } = renderHook(() => useProposedEditPresenter(P, { onSaved: vi.fn() }));
    expect(result.current.sourceDocument).toBe('QĐ 123');
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setSourceProvider('  '));
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setSourceProvider('Sở Công Thương'));
    expect(result.current.canSave).toBe(true);
  });

  it('saves only changed columns with the source, then reports the count', async () => {
    updateFeature.mockResolvedValue({ id: 'f1' });
    const onSaved = vi.fn();
    const { result } = renderHook(() => useProposedEditPresenter(P, { onSaved }));
    act(() => result.current.setSourceProvider('Sở Công Thương'));
    await act(() => result.current.submit());
    expect(updateFeature).toHaveBeenCalledWith('dams', 'f1', {
      properties: { wattage_mw: '72' },
      source: { document: 'QĐ 123', provider: 'Sở Công Thương' },
    });
    expect(onSaved).toHaveBeenCalledWith(1);
  });

  it('maps a 403 to a Vietnamese permission message and keeps the values', async () => {
    updateFeature.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    const { result } = renderHook(() => useProposedEditPresenter(P, { onSaved: vi.fn() }));
    act(() => result.current.setSourceProvider('Sở Công Thương'));
    await act(() => result.current.submit());
    expect(result.current.error).toBe('Bạn không có quyền cập nhật.');
    expect(result.current.values.wattage_mw).toBe('72');
  });
});
